-- "Outer NazAI" plan, item 9: abuse/cost-bomb alerting for control-api.
--
-- abuse_alerted_at lives on the api_keys row itself, mirroring
-- webhooks.alerted_at (20260824030000) and
-- agent_integrations.revoked_alerted_at (20260825020000): the sweep's
-- lookback is a MOVING window (e.g. the last 15 minutes), not a
-- cumulative state, so without a clear-on-recovery step a key that spikes
-- once would never be able to alert again on a second, later spike --
-- the sweep clears this the moment a key's rolling-window activity drops
-- back under both thresholds, exactly like those two precedents.
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS abuse_alerted_at timestamptz;

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
      'control_api_abuse'
    )
  );
