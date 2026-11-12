-- Found in the security sweep of 2026-11-12:
-- 1. rotate_webhook_secret(uuid) called gen_random_bytes(), which lives in the "extensions" schema, but the function's search_path is
--    public, vault, pg_temp. So the agent panel's "rotate webhook secret" button failed for everyone ("function gen_random_bytes(integer)
--    does not exist"): a leaked webhook secret could not be rotated. It now calls extensions.gen_random_bytes().
-- 2. read_webhook_secret / rotate_webhook_secret decided "is this the owner or the server?" with auth.role() <> 'service_role'. When there
--    is no role at all (auth.role() is NULL: only a direct database connection, never the API) that comparison is NULL, not true, and the
--    "not authorized" branch was skipped. Both now treat a missing role as "not the server".
-- 3. Two trigger functions had no fixed search_path (Supabase advisor 0011). They only use built-in functions; the path is fixed.
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(_agent_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault', 'pg_temp' AS $function$
DECLARE
  sid uuid;
  owner uuid;
  new_secret text;
BEGIN
  SELECT webhook_secret_id, user_id INTO sid, owner FROM public.agents WHERE id = _agent_id;
  IF owner IS NULL THEN RAISE EXCEPTION 'agent not found'; END IF;
  IF coalesce(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM owner THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  new_secret := encode(extensions.gen_random_bytes(24), 'hex');
  IF sid IS NULL THEN
    SELECT vault.create_secret(new_secret, 'agent-webhook-' || _agent_id::text, 'agents.webhook_secret') INTO sid;
    UPDATE public.agents SET webhook_secret_id = sid WHERE id = _agent_id;
  ELSE
    PERFORM vault.update_secret(sid, new_secret);
  END IF;
  RETURN new_secret;
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_webhook_secret(_agent_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault', 'pg_temp' AS $function$
DECLARE
  sid uuid;
  owner uuid;
  raw text;
BEGIN
  SELECT webhook_secret_id, user_id INTO sid, owner FROM public.agents WHERE id = _agent_id;
  IF sid IS NULL THEN RETURN NULL; END IF;
  IF coalesce(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM owner THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT decrypted_secret INTO raw FROM vault.decrypted_secrets WHERE id = sid;
  RETURN raw;
END;
$function$;

ALTER FUNCTION public.guard_outer_control_completed() SET search_path = public, pg_temp;
ALTER FUNCTION public.guard_outer_control_task_completed() SET search_path = public, pg_temp;
