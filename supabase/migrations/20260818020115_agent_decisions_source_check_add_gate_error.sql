-- runControlGate now has an explicit fail-closed branch (control-gate.ts):
-- any unexpected error while judging an action (a transient DB/network
-- failure mid-gate) is now caught and logged as a genuine BLOCK, with
-- source='gate_error', instead of letting the exception escape uncaught.
-- Add it to the same CHECK constraint fixed in
-- 20260818015349_fix_agent_decisions_source_check.sql — a new migration
-- rather than editing that one in place, since migrations are treated as
-- immutable once committed.
ALTER TABLE public.agent_decisions
  DROP CONSTRAINT IF EXISTS agent_decisions_source_check;

ALTER TABLE public.agent_decisions
  ADD CONSTRAINT agent_decisions_source_check CHECK (
    source IN (
      'model',
      'human_override',
      'kill_switch',
      'ai_spend_cap',
      'hard_rule',
      'circuit_breaker',
      'circuit_breaker_trip',
      'safety_scanner',
      'anomaly_detector',
      'gate_error'
    )
  );
