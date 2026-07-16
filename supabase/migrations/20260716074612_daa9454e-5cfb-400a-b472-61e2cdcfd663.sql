
-- 1. Add column for Vault secret id
ALTER TABLE public.agent_integrations
  ADD COLUMN IF NOT EXISTS credentials_secret_id UUID;

-- 2. Wrapper RPCs for Vault access (SECURITY DEFINER, service_role only).
--    Storing/fetching secrets outside vault requires elevated privileges;
--    these functions expose the minimum needed surface.

CREATE OR REPLACE FUNCTION public.create_integration_secret(payload JSONB, label TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT vault.create_secret(payload::text, COALESCE(label, 'integration-' || gen_random_uuid()::text), 'agent_integrations credentials') INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_integration_secret(sid UUID, payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  PERFORM vault.update_secret(sid, payload::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_integration_secret(sid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  DELETE FROM vault.secrets WHERE id = sid;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_integration_secret(sid UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  raw TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT decrypted_secret INTO raw FROM vault.decrypted_secrets WHERE id = sid;
  IF raw IS NULL THEN RETURN NULL; END IF;
  RETURN raw::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION public.create_integration_secret(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_integration_secret(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_integration_secret(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_integration_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_integration_secret(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_integration_secret(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_integration_secret(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_integration_secret(UUID) TO service_role;

-- 3. Backfill: wrap existing plaintext credentials into Vault secrets.
DO $$
DECLARE
  r RECORD;
  new_id UUID;
BEGIN
  FOR r IN
    SELECT id, credentials
    FROM public.agent_integrations
    WHERE credentials_secret_id IS NULL
      AND credentials IS NOT NULL
      AND jsonb_typeof(credentials) = 'object'
      AND credentials <> '{}'::jsonb
  LOOP
    SELECT vault.create_secret(
      r.credentials::text,
      'integration-' || r.id::text,
      'agent_integrations credentials (migrated)'
    ) INTO new_id;
    UPDATE public.agent_integrations
    SET credentials_secret_id = new_id
    WHERE id = r.id;
  END LOOP;
END $$;
