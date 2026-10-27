-- Secrets handling, front 3: a stored secret lives exactly as long as something uses it.
--
-- Six columns point at a customer's secret in Vault:
--   agent_integrations.credentials_secret_id   an integration's OAuth tokens or pasted key
--   external_tools.credentials_secret_id       an Outer Control tool's key
--   webhooks.secret_id / previous_secret_id    an outbound webhook's signing secret (and the rotated-out one)
--   api_keys.callback_secret_id                an API key's callback secret
--   agents.webhook_secret_id                   an agent's inbound webhook secret
-- When a row stops pointing at a secret (the row is deleted, a key is replaced, a tool is removed, an account is deleted and its
-- rows go with it) the secret is deleted, unless another row still points at it. NazAI's own secrets (the decision signing keys,
-- the cron service key) are never referenced by these columns and are never touched.

-- True while any of the six columns still points at the secret.
CREATE OR REPLACE FUNCTION public.vault_secret_in_use(sid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.agent_integrations WHERE credentials_secret_id = sid)
      OR EXISTS (SELECT 1 FROM public.external_tools WHERE credentials_secret_id = sid)
      OR EXISTS (SELECT 1 FROM public.webhooks WHERE secret_id = sid OR previous_secret_id = sid)
      OR EXISTS (SELECT 1 FROM public.api_keys WHERE callback_secret_id = sid)
      OR EXISTS (SELECT 1 FROM public.agents WHERE webhook_secret_id = sid);
$$;
REVOKE ALL ON FUNCTION public.vault_secret_in_use(uuid) FROM PUBLIC, anon, authenticated;

-- The trigger behind all six columns (the trigger's arguments name the table's secret columns). Replaces the front 1 version,
-- which knew only webhooks and api_keys and did not check whether another row shared the secret.
CREATE OR REPLACE FUNCTION public.forget_replaced_vault_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  col text;
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  sid uuid;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    sid := nullif(old_row ->> col, '')::uuid;
    IF sid IS NOT NULL AND sid IS DISTINCT FROM nullif(new_row ->> col, '')::uuid AND NOT public.vault_secret_in_use(sid) THEN
      DELETE FROM vault.secrets WHERE id = sid;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.forget_replaced_vault_secrets() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER webhooks_forget_vault_secrets AFTER UPDATE OF secret_id, previous_secret_id OR DELETE ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.forget_replaced_vault_secrets('secret_id', 'previous_secret_id');
CREATE OR REPLACE TRIGGER api_keys_forget_vault_secrets AFTER UPDATE OF callback_secret_id OR DELETE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.forget_replaced_vault_secrets('callback_secret_id');
CREATE OR REPLACE TRIGGER agent_integrations_forget_vault_secrets AFTER UPDATE OF credentials_secret_id OR DELETE ON public.agent_integrations
  FOR EACH ROW EXECUTE FUNCTION public.forget_replaced_vault_secrets('credentials_secret_id');
CREATE OR REPLACE TRIGGER external_tools_forget_vault_secrets AFTER UPDATE OF credentials_secret_id OR DELETE ON public.external_tools
  FOR EACH ROW EXECUTE FUNCTION public.forget_replaced_vault_secrets('credentials_secret_id');
CREATE OR REPLACE TRIGGER agents_forget_vault_secrets AFTER UPDATE OF webhook_secret_id OR DELETE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.forget_replaced_vault_secrets('webhook_secret_id');

-- What happened to stored secrets: a revocation at a provider (and whether it worked), an orphan sweep run. Server only; the detail
-- is scrubbed like every other stored error.
CREATE TABLE IF NOT EXISTS public.secret_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  kind text NOT NULL,
  provider text,
  outcome text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.secret_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.secret_events FROM anon, authenticated;
GRANT ALL ON TABLE public.secret_events TO service_role;
CREATE INDEX IF NOT EXISTS secret_events_kind_created ON public.secret_events (kind, created_at DESC);
CREATE OR REPLACE TRIGGER secret_events_redact_errors BEFORE INSERT OR UPDATE OF detail ON public.secret_events
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('detail');

-- The safety net: deletes any customer secret nothing points at any more (left behind by a path that bypassed the trigger, or a
-- create whose row insert failed). Only secrets stored the way NazAI stores customer secrets are candidates, and only after an
-- hour, so a secret created a moment before its row is never taken. Every run is recorded; finding any opens a platform incident.
CREATE OR REPLACE FUNCTION public.sweep_orphan_vault_secrets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  removed text[];
BEGIN
  WITH gone AS (
    DELETE FROM vault.secrets s
    WHERE s.description IN ('agent_integrations credentials', 'agent_integrations credentials (migrated)', 'webhook signing secret',
                            'webhook previous signing secret', 'API key callback secret', 'agents.webhook_secret')
      AND s.created_at < now() - interval '1 hour'
      AND NOT public.vault_secret_in_use(s.id)
    RETURNING s.name
  )
  SELECT coalesce(array_agg(name ORDER BY name), '{}') INTO removed FROM gone;

  INSERT INTO public.secret_events (kind, outcome, detail)
  VALUES ('orphan_sweep', cardinality(removed) || ' deleted', CASE WHEN cardinality(removed) > 0 THEN array_to_string(removed, ', ') END);

  IF cardinality(removed) > 0 AND NOT EXISTS (SELECT 1 FROM public.platform_incidents WHERE kind = 'orphan_vault_secrets' AND resolved_at IS NULL) THEN
    INSERT INTO public.platform_incidents (kind, summary, detail)
    VALUES ('orphan_vault_secrets', cardinality(removed) || ' stored secret(s) were no longer used by anything and were deleted. Find the path that left them behind.',
            jsonb_build_object('names', to_jsonb(removed)));
  END IF;
  RETURN cardinality(removed);
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_orphan_vault_secrets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_orphan_vault_secrets() TO service_role;

-- Weekly, Monday 03:17 UTC.
SELECT cron.schedule('secret-orphan-sweep-weekly', '17 3 * * 1', $$SELECT public.sweep_orphan_vault_secrets()$$);

-- Leftovers from before tools gave their key back on removal: removed tools stop pointing at their keys, and the trigger deletes
-- each key no live row still uses.
UPDATE public.external_tools SET credentials_secret_id = NULL WHERE removed_at IS NOT NULL AND credentials_secret_id IS NOT NULL;
