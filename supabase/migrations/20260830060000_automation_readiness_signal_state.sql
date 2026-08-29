-- "Knowledge & autonomy" plan, item 6: real-time webhooks for every
-- automation-state change. Three of the five new webhook events
-- (hard_rule_auto_drafted, api_key_auto_paused,
-- api_key_on_uncertain_downgraded) need no new schema at all -- they
-- fire straight from existing scheduled sweeps, wired at
-- application-code level only. These two (automation_readiness_ready,
-- shadow_policy_promotion_ready) need a live "did this just become
-- true" signal, since their underlying reports (last round's
-- automation-readiness.ts/api-key-policy.ts) are pull-only with no
-- natural "this just changed" moment -- this table is that moment,
-- computed by a small new daily sweep (readiness-webhook-sweep/
-- index.ts) and compared against on each run.
--
-- Deliberately service-role only, no user-facing RLS SELECT policy --
-- this is internal sweep bookkeeping, not a report an account reads
-- directly (the underlying GET /api-keys/:id/automation-readiness and
-- GET /api-keys/:id/shadow-summary endpoints already serve that).
CREATE TABLE IF NOT EXISTS public.automation_readiness_signal_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  signal text NOT NULL CHECK (signal IN ('automation_readiness', 'shadow_promotion')),
  ready boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_readiness_signal_state_unique UNIQUE (api_key_id, signal)
);

GRANT ALL ON public.automation_readiness_signal_state TO service_role;
ALTER TABLE public.automation_readiness_signal_state ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POST-MIGRATION STEP (same convention as every other scheduled sweep in
-- this codebase -- applied directly, not committed as static SQL, since
-- it needs a project-specific service_role key and function URL):
--
-- CRON JOB (pg_cron): schedule 'readiness-webhook-sweep-daily' once a
-- day, reusing the existing 'email_queue_service_role_key' vault secret
-- as the Authorization bearer token:
--
--    SELECT cron.schedule(
--      'readiness-webhook-sweep-daily',
--      '0 10 * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/readiness-webhook-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
