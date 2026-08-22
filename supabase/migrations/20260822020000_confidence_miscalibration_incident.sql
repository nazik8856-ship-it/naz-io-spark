-- 2026-08-22 plan item 4: a severely miscalibrated confidence bucket is
-- treated like every other "something is actually wrong" signal -- same
-- sendCriticalAlert + auto-opened-incident pattern as hard_rule_block,
-- kill_switch_auto and gate_error -- instead of sitting quietly in
-- confidence_calibration where nothing in the product ever surfaces it
-- proactively (item 3 built the on-demand view; this is the push side).
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
      'confidence_miscalibrated'
    )
  );
