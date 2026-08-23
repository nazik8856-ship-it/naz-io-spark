-- 2026-08-24 plan item 7: webhook dead-letter alerting when retries exhaust.
-- webhook-retry.ts's isRetryEligible returns false once attempt >=
-- MAX_ATTEMPTS (5) with no alert or incident fired anywhere -- a
-- permanently-broken customer webhook receiver produces zero signal to
-- anyone.
--
-- alerted_at lives on the webhook (the endpoint), not on an individual
-- webhook_deliveries row: each attempt is its own append-only delivery row
-- (never overwritten), and a genuinely dead endpoint gets a FRESH delivery
-- chain -- and its own independent exhaustion -- for every new event that
-- fires while it's down (approval_created, incident_opened, ...). Scoping
-- the "already alerted" flag to the delivery row would only silence the one
-- chain that happened to trip it; the next chain to exhaust minutes later
-- would alert again for the same dead endpoint. Scoping it to the webhook
-- itself, cleared the next time a delivery to it actually succeeds, is what
-- "doesn't re-fire for the same dead endpoint" actually requires.
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS alerted_at timestamptz;

-- Same alert + incident treatment as every other "something is actually
-- wrong" signal this project already has.
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
      'webhook_delivery_exhausted'
    )
  );
