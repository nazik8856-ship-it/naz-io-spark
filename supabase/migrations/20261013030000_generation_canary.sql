-- Generation canary (2026-10-13): history of the scheduled health checks that
-- exercise the real AI provider (see supabase/functions/generation-canary).
-- Service-role only: RLS is on with no policies, so no client can read or write it.
CREATE TABLE IF NOT EXISTS public.generation_canary_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL CHECK (mode IN ('provider', 'generation')),
  ok boolean NOT NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms integer,
  est_cost_usd numeric(8,4) NOT NULL DEFAULT 0,
  out_of_credits boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS generation_canary_runs_created_idx ON public.generation_canary_runs (created_at DESC);
ALTER TABLE public.generation_canary_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.generation_canary_runs TO service_role;

-- ============================================================
-- POST-MIGRATION STEP (applied directly; needs the project URL and vault key).
-- Cost note: "provider" is ~$0.01 per run, "generation" is ~$0.15 per run.
--
--   SELECT cron.schedule('generation-canary-provider-4h', '17 */4 * * *', $$
--     INSERT INTO public.scheduled_job_requests (job_name, request_id)
--     SELECT 'generation-canary-provider-4h', net.http_post(
--       url := '<SUPABASE_URL>/functions/v1/generation-canary',
--       headers := jsonb_build_object('Content-Type','application/json',
--         'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')),
--       body := '{"mode":"provider"}'::jsonb, timeout_milliseconds := 120000);
--   $$);
--   SELECT cron.schedule('generation-canary-daily', '41 5 * * *', $$
--     INSERT INTO public.scheduled_job_requests (job_name, request_id)
--     SELECT 'generation-canary-daily', net.http_post(
--       url := '<SUPABASE_URL>/functions/v1/generation-canary',
--       headers := jsonb_build_object('Content-Type','application/json',
--         'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')),
--       body := '{"mode":"generation"}'::jsonb, timeout_milliseconds := 175000);
--   $$);
-- ============================================================
