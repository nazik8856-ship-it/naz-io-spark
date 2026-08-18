-- Escalation timers on pending approvals: a pending approval left
-- untouched past a risk-scaled threshold fires a stronger alert and opens
-- an incident, instead of sitting silently in the queue forever.
ALTER TABLE public.pending_approvals
  ADD COLUMN escalated_at timestamptz;

ALTER TABLE public.incidents
  DROP CONSTRAINT IF EXISTS incidents_kind_check;

ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_kind_check CHECK (
    kind IN (
      'kill_switch_auto',
      'circuit_breaker_trip',
      'gate_error',
      'self_audit_regression',
      'approval_escalated'
    )
  );

-- ============================================================
-- POST-MIGRATION STEP (same convention as control-self-audit-weekly in
-- 20260817031418_control_test_runs.sql — applied directly, not committed
-- as static SQL, since it needs a project-specific service_role key and
-- function URL):
--
-- CRON JOB (pg_cron): schedule 'approval-escalation-sweep-30min' every 30
-- minutes, reusing the existing 'email_queue_service_role_key' vault
-- secret as the Authorization bearer token:
--
--    SELECT cron.schedule(
--      'approval-escalation-sweep-30min',
--      '*/30 * * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/approval-escalation-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
--    To revert: SELECT cron.unschedule('approval-escalation-sweep-30min');
-- ============================================================
