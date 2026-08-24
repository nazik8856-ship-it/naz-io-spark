-- 2026-08-25 plan item 8: proactively alert when a connected integration's
-- token is revoked.
--
-- Confirmed: gmail.ts/figma.ts/canva.ts already correctly catch
-- invalid_grant and flip agent_integrations.status to 'error' with a
-- human-readable last_error -- but nothing pushed this out. recordIssue()
-- is only ever called from agent-runtime/index.ts, so a dormant agent's
-- dead integration was discovered only the next time something happened to
-- hit it. A new scheduled sweep (integration-revocation-sweep) now queries
-- for status = 'error' rows and fires a sendCriticalAlert for each newly
-- broken one.
--
-- revoked_alerted_at lives on the integration row itself, mirroring
-- webhooks.alerted_at from 20260824030000_webhook_delivery_exhausted.sql:
-- cleared every time the row goes back to status = 'connected' (a clean
-- OAuth reconnect, or a successful silent token refresh), so a second,
-- later break gets its own fresh alert instead of staying silenced by a
-- flag from a break that's already been fixed.
ALTER TABLE public.agent_integrations ADD COLUMN IF NOT EXISTS revoked_alerted_at timestamptz;

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
      'integration_revoked'
    )
  );

-- Registration (run manually against the project once Lovable Credits
-- access is available -- this sandbox has no live DB access):
--
--    SELECT cron.schedule(
--      'integration-revocation-sweep',
--      '*/30 * * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/integration-revocation-sweep',
--        headers := jsonb_build_object(
--          'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--          'Content-Type', 'application/json'
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
