-- Secrets handling, front 2: no stored error message or stop reason keeps a secret. Providers sometimes echo a token back in an
-- error ("invalid token sk-…", a failing URL with ?access_token=…); whatever code path writes the message, a trigger scrubs it
-- as it is written, and what is already stored is scrubbed once here.
--
-- redact_secrets() is the SQL twin of _shared/redact-secrets.ts (same patterns; a test checks both give the same text). The
-- secret is replaced by [REDACTED:secrets], the rest of the message stays.
CREATE OR REPLACE FUNCTION public.redact_secrets(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r text := t;
BEGIN
  IF r IS NULL OR r = '' THEN RETURN r; END IF;
  -- Values that are a credential by their shape.
  r := regexp_replace(r,
    '(sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{16,}|sk_test_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[A-Za-z0-9._-]{20,}|secret_[A-Za-z0-9]{30,}|ntn_[A-Za-z0-9]{30,}|shpat_[A-Fa-f0-9]{20,}|re_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]{5,})?)',
    '[REDACTED:secrets]', 'g');
  r := regexp_replace(r, '-----BEGIN [A-Z ]*PRIVATE KEY-----.*(-----END [A-Z ]*PRIVATE KEY-----|$)', '[REDACTED:secrets]', 'g');
  -- A value right after a name that says it is a secret.
  r := regexp_replace(r,
    '(\y(authorization|proxy-authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|webhook[_-]?secret|signing[_-]?secret|secret|password|passwd|pwd|token|cookie|set-cookie)\y["'']?\s*[:=]\s*["'']?)(?!\[REDACTED|(Bearer|Basic|Token)\s+\[REDACTED)((Bearer|Basic|Token)\s+)?[^]\s"'',;&}]{6,}',
    '\1[REDACTED:secrets]', 'gi');
  -- "Bearer …" anywhere else.
  r := regexp_replace(r, '\y(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}', '\1 [REDACTED:secrets]', 'g');
  -- Secret query parameters in a URL.
  r := regexp_replace(r,
    '([?&#](access_token|refresh_token|id_token|token|key|api_key|apikey|client_secret|code|signature|sig|password)=)[^&#\s"'']+',
    '\1[REDACTED:secrets]', 'gi');
  RETURN r;
END;
$$;

-- JSON details (an incident's detail, for one): every string inside is scrubbed, and a value under a secret-named key is replaced
-- whole, as redactDeep() does in the functions.
CREATE OR REPLACE FUNCTION public.redact_secrets_jsonb(j jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  k text;
  v jsonb;
  out jsonb;
BEGIN
  CASE jsonb_typeof(j)
    WHEN 'string' THEN
      RETURN to_jsonb(public.redact_secrets(j #>> '{}'));
    WHEN 'object' THEN
      out := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
        out := out || jsonb_build_object(k,
          CASE WHEN k ~* '^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|token|private[_-]?key|credentials?|service[_-]?key|webhook[_-]?secret|signing[_-]?secret|callback[_-]?secret)$'
                 AND jsonb_typeof(v) <> 'null' AND v <> '""'::jsonb
            THEN to_jsonb('[REDACTED:secrets]'::text)
            ELSE public.redact_secrets_jsonb(v) END);
      END LOOP;
      RETURN out;
    WHEN 'array' THEN
      SELECT coalesce(jsonb_agg(public.redact_secrets_jsonb(e) ORDER BY n), '[]'::jsonb) INTO out
      FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, n);
      RETURN out;
    ELSE
      RETURN j;
  END CASE;
END;
$$;

-- Scrubs the named columns of the row being written (the trigger's arguments): a text column as text, a JSON column through
-- redact_secrets_jsonb().
CREATE OR REPLACE FUNCTION public.redact_error_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  col text;
  j jsonb := to_jsonb(NEW);
  changed boolean := false;
  before_value jsonb;
  after_value jsonb;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    before_value := j -> col;
    IF before_value IS NOT NULL AND jsonb_typeof(before_value) <> 'null' THEN
      after_value := public.redact_secrets_jsonb(before_value);
      IF after_value IS DISTINCT FROM before_value THEN
        j := jsonb_set(j, ARRAY[col], after_value);
        changed := true;
      END IF;
    END IF;
  END LOOP;
  IF changed THEN NEW := jsonb_populate_record(NEW, j); END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER action_reversals_redact_errors BEFORE INSERT OR UPDATE OF error, irreversible_reason ON public.action_reversals
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('error', 'irreversible_reason');
CREATE OR REPLACE TRIGGER agent_integrations_redact_errors BEFORE INSERT OR UPDATE OF last_error ON public.agent_integrations
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('last_error');
CREATE OR REPLACE TRIGGER circuit_breakers_redact_errors BEFORE INSERT OR UPDATE OF last_reason ON public.circuit_breakers
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('last_reason');
CREATE OR REPLACE TRIGGER email_send_log_redact_errors BEFORE INSERT OR UPDATE OF error_message ON public.email_send_log
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('error_message');
CREATE OR REPLACE TRIGGER external_tools_redact_errors BEFORE INSERT OR UPDATE OF last_error ON public.external_tools
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('last_error');
CREATE OR REPLACE TRIGGER imported_projects_redact_errors BEFORE INSERT OR UPDATE OF sync_error ON public.imported_projects
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('sync_error');
CREATE OR REPLACE TRIGGER integration_snapshots_redact_errors BEFORE INSERT OR UPDATE OF error ON public.integration_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('error');
CREATE OR REPLACE TRIGGER outer_control_evaluations_redact_errors BEFORE INSERT OR UPDATE OF execution_summary ON public.outer_control_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('execution_summary');
CREATE OR REPLACE TRIGGER outer_control_session_steps_redact_errors BEFORE INSERT OR UPDATE OF error ON public.outer_control_session_steps
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('error');
CREATE OR REPLACE TRIGGER outer_control_sessions_redact_errors BEFORE INSERT OR UPDATE OF stop_reason ON public.outer_control_sessions
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('stop_reason');
CREATE OR REPLACE TRIGGER outer_control_workflows_redact_errors BEFORE INSERT OR UPDATE OF stop_reason, blocked_reason ON public.outer_control_workflows
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('stop_reason', 'blocked_reason');
CREATE OR REPLACE TRIGGER pending_approvals_redact_errors BEFORE INSERT OR UPDATE OF execution_error, execution_summary ON public.pending_approvals
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('execution_error', 'execution_summary');
CREATE OR REPLACE TRIGGER platform_incidents_redact_errors BEFORE INSERT OR UPDATE OF detail ON public.platform_incidents
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('detail');
CREATE OR REPLACE TRIGGER webhook_deliveries_redact_errors BEFORE INSERT OR UPDATE OF error ON public.webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_columns('error');

-- What is already stored: scrubbed once (the triggers above do the rewriting).
UPDATE public.action_reversals SET error = error, irreversible_reason = irreversible_reason
  WHERE (error IS NOT NULL AND error IS DISTINCT FROM public.redact_secrets(error))
     OR (irreversible_reason IS NOT NULL AND irreversible_reason IS DISTINCT FROM public.redact_secrets(irreversible_reason));
UPDATE public.agent_integrations SET last_error = last_error WHERE last_error IS NOT NULL AND last_error IS DISTINCT FROM public.redact_secrets(last_error);
UPDATE public.circuit_breakers SET last_reason = last_reason WHERE last_reason IS NOT NULL AND last_reason IS DISTINCT FROM public.redact_secrets(last_reason);
UPDATE public.email_send_log SET error_message = error_message WHERE error_message IS NOT NULL AND error_message IS DISTINCT FROM public.redact_secrets(error_message);
UPDATE public.external_tools SET last_error = last_error WHERE last_error IS NOT NULL AND last_error IS DISTINCT FROM public.redact_secrets(last_error);
UPDATE public.imported_projects SET sync_error = sync_error WHERE sync_error IS NOT NULL AND sync_error IS DISTINCT FROM public.redact_secrets(sync_error);
UPDATE public.integration_snapshots SET error = error WHERE error IS NOT NULL AND error IS DISTINCT FROM public.redact_secrets(error);
UPDATE public.outer_control_evaluations SET execution_summary = execution_summary WHERE execution_summary IS NOT NULL AND execution_summary IS DISTINCT FROM public.redact_secrets(execution_summary);
UPDATE public.outer_control_session_steps SET error = error WHERE error IS NOT NULL AND error IS DISTINCT FROM public.redact_secrets(error);
UPDATE public.outer_control_sessions SET stop_reason = stop_reason WHERE stop_reason IS NOT NULL AND stop_reason IS DISTINCT FROM public.redact_secrets(stop_reason);
UPDATE public.outer_control_workflows SET stop_reason = stop_reason, blocked_reason = blocked_reason
  WHERE (stop_reason IS NOT NULL AND stop_reason IS DISTINCT FROM public.redact_secrets(stop_reason))
     OR (blocked_reason IS NOT NULL AND blocked_reason IS DISTINCT FROM public.redact_secrets(blocked_reason));
UPDATE public.pending_approvals SET execution_error = execution_error, execution_summary = execution_summary
  WHERE (execution_error IS NOT NULL AND execution_error IS DISTINCT FROM public.redact_secrets(execution_error))
     OR (execution_summary IS NOT NULL AND execution_summary IS DISTINCT FROM public.redact_secrets(execution_summary));
UPDATE public.platform_incidents SET detail = detail WHERE detail IS NOT NULL AND detail IS DISTINCT FROM public.redact_secrets_jsonb(detail);
UPDATE public.webhook_deliveries SET error = error WHERE error IS NOT NULL AND error IS DISTINCT FROM public.redact_secrets(error);
