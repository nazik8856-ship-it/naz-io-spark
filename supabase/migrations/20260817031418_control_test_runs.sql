-- Persists every control-test-suite run (manual or scheduled) so the weekly
-- self-audit has something to diff against: "did a scenario that used to
-- pass just start failing" needs a stored prior result, not just today's.
CREATE TABLE public.control_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_version integer,
  policy_version_id uuid,
  triggered_by text NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'scheduled')),
  pass_rate_pct numeric NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  scenario_status jsonb NOT NULL DEFAULT '{}'::jsonb, -- { [scenario_id]: "pass" | "soft_pass" | "fail" | "error" }
  regressions jsonb NOT NULL DEFAULT '[]'::jsonb,      -- scenario ids that passed last run and don't now
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_control_test_runs_user_created
  ON public.control_test_runs (user_id, created_at DESC);

GRANT SELECT ON public.control_test_runs TO authenticated;
GRANT ALL ON public.control_test_runs TO service_role;

ALTER TABLE public.control_test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own control test runs"
ON public.control_test_runs FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- ============================================================
-- POST-MIGRATION STEP (applied dynamically, same convention as the
-- process-email-queue cron job in 20260427022953_email_infra.sql — a
-- project-specific service_role key and function URL can't be committed as
-- static SQL):
--
-- 1. VAULT SECRET: store/update the service_role key in vault as
--    'control_self_audit_service_role_key' (or reuse the existing
--    'email_queue_service_role_key' secret if this project already has one —
--    same key, just needs to be readable under a name this job's SQL uses).
--
-- 2. CRON JOB (pg_cron): schedule 'control-self-audit-weekly' to run once a
--    week (e.g. Monday 06:00 UTC) and POST to the control-self-audit Edge
--    Function with the vault-stored service_role key as its Authorization
--    bearer token:
--
--    SELECT cron.schedule(
--      'control-self-audit-weekly',
--      '0 6 * * 1',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/control-self-audit',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'control_self_audit_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
--    To revert: SELECT cron.unschedule('control-self-audit-weekly');
-- ============================================================
