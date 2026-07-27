CREATE OR REPLACE FUNCTION public.create_integration_secret(payload jsonb, label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
DECLARE
  new_id UUID;
  effective_label TEXT;
  existing_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  effective_label := COALESCE(label, 'integration-' || gen_random_uuid()::text);

  -- Upsert by name: if a vault secret with this label already exists, update
  -- it in place and reuse its id, rather than erroring with the unique index
  -- violation on secrets_name_idx.
  SELECT id INTO existing_id FROM vault.secrets WHERE name = effective_label;
  IF existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(existing_id, payload::text);
    RETURN existing_id;
  END IF;

  SELECT vault.create_secret(payload::text, effective_label, 'agent_integrations credentials') INTO new_id;
  RETURN new_id;
END;
$function$;