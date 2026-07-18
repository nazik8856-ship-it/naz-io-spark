
-- 1) Add vault reference column
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS webhook_secret_id uuid;

-- 2) RPCs for webhook secret management via Vault
CREATE OR REPLACE FUNCTION public.read_webhook_secret(_agent_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  sid uuid;
  owner uuid;
  raw text;
BEGIN
  SELECT webhook_secret_id, user_id INTO sid, owner FROM public.agents WHERE id = _agent_id;
  IF sid IS NULL THEN RETURN NULL; END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM owner THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT decrypted_secret INTO raw FROM vault.decrypted_secrets WHERE id = sid;
  RETURN raw;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(_agent_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  sid uuid;
  owner uuid;
  new_secret text;
BEGIN
  SELECT webhook_secret_id, user_id INTO sid, owner FROM public.agents WHERE id = _agent_id;
  IF owner IS NULL THEN RAISE EXCEPTION 'agent not found'; END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM owner THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  new_secret := encode(gen_random_bytes(24), 'hex');
  IF sid IS NULL THEN
    SELECT vault.create_secret(new_secret, 'agent-webhook-' || _agent_id::text, 'agents.webhook_secret') INTO sid;
    UPDATE public.agents SET webhook_secret_id = sid WHERE id = _agent_id;
  ELSE
    PERFORM vault.update_secret(sid, new_secret);
  END IF;
  RETURN new_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.read_webhook_secret(uuid) FROM public;
REVOKE ALL ON FUNCTION public.rotate_webhook_secret(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.read_webhook_secret(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid) TO authenticated, service_role;

-- 3) Backfill existing plaintext secrets into Vault
DO $$
DECLARE
  r record;
  new_sid uuid;
BEGIN
  FOR r IN SELECT id, webhook_secret FROM public.agents WHERE webhook_secret_id IS NULL AND webhook_secret IS NOT NULL LOOP
    SELECT vault.create_secret(r.webhook_secret, 'agent-webhook-' || r.id::text, 'agents.webhook_secret migrated') INTO new_sid;
    UPDATE public.agents SET webhook_secret_id = new_sid WHERE id = r.id;
  END LOOP;
END $$;

-- 4) Drop plaintext column
ALTER TABLE public.agents DROP COLUMN IF EXISTS webhook_secret;
