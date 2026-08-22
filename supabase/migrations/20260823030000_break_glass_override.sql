-- 2026-08-23 plan item 4: break-glass single-action override.
-- No override mechanism exists today for a BLOCK verdict -- only
-- require_approval verdicts get a pending_approvals row; block verdicts
-- dead-end. This adds the two columns the new override endpoint needs:
--
-- - params: the action payload, captured ONLY at the two BLOCK sources
--   that already have ctx.params in scope when they call logStop
--   (hard_rule and safety_scanner) -- every other block source (kill
--   switch, spend cap, circuit breaker) stays out of scope for break-glass,
--   same as the plan's own scoping call. Nullable, not backfilled.
-- - overridden_at: claimed atomically (UPDATE ... WHERE overridden_at IS
--   NULL), mirroring pending_approvals.executed_at, so two concurrent
--   override attempts on the same blocked decision can't both re-run the
--   action.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS params jsonb,
  ADD COLUMN IF NOT EXISTS overridden_at timestamptz;

-- A human bypassing a block is exactly the kind of consequential event the
-- rest of this project already alerts + opens an incident for (hard rule
-- blocks, circuit breaker trips, kill-switch auto-trips) -- unlike a
-- routine kill-switch toggle, this is a deliberate override of a safety
-- control and is worth surfacing for later review even though it's a
-- deliberate human action.
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
      'break_glass_override'
    )
  );
