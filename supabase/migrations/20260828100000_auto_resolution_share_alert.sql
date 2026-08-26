-- "Zero human review" plan, item 14: once items 1/2/4 exist, an account
-- could set a policy that's quietly too permissive and never find out --
-- by definition, nobody's watching each individual decision anymore once
-- it's auto-resolved. Add a proactive alert for a sharply
-- higher-than-normal share of an account's resolved decisions suddenly
-- being resolved automatically.
--
-- auto_resolution_share_alerted_at lives on profiles (one row per
-- account), mirroring api_keys.abuse_alerted_at / webhooks.alerted_at /
-- agent_integrations.revoked_alerted_at: the sweep's recent window is a
-- MOVING window (the last 24 hours), not cumulative state, so without a
-- clear-on-recovery step an account that spikes once could never alert
-- again on a second, later spike.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auto_resolution_share_alerted_at timestamptz;

ALTER TABLE public.incidents
  DROP CONSTRAINT IF EXISTS incidents_kind_check;

ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_kind_check CHECK (
    kind IN (
      'kill_switch_auto',
      'circuit_breaker_trip',
      'gate_error',
      'self_audit_regression',
      'approval_escalated',
      'confidence_miscalibrated',
      'break_glass_override',
      'correlated_breaker_trip',
      'audit_integrity_failure',
      'webhook_delivery_exhausted',
      'integration_revoked',
      'control_api_abuse',
      'gate_error_fail_open',
      'auto_resolution_share_spike'
    )
  );

-- ============================================================
-- POST-MIGRATION STEP (same convention as control-api-abuse-sweep in
-- 20260826060000_control_api_abuse_alert.sql -- applied directly, not
-- committed as static SQL, since it needs a project-specific service_role
-- key and function URL):
--
-- CRON JOB (pg_cron): schedule 'auto-resolution-share-sweep-30min' every
-- 30 minutes, reusing the existing 'email_queue_service_role_key' vault
-- secret as the Authorization bearer token:
--
--    SELECT cron.schedule(
--      'auto-resolution-share-sweep-30min',
--      '*/30 * * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/auto-resolution-share-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
--    To revert: SELECT cron.unschedule('auto-resolution-share-sweep-30min');
-- ============================================================
