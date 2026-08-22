-- CRITICAL FIX (recurrence of the exact bug class 20260818015349 fixed):
-- agent_decisions_source_check never learned about 'agent_kill_switch' and
-- 'agent_ai_spend_cap' -- the two source values control-gate.ts started
-- writing in 20260821020000_per_agent_spend_cap.sql (Wave 5 session 1) for
-- an agent-scoped kill-switch/spend-cap block, three days after the CHECK
-- constraint was last extended.
--
-- Same silent-failure mechanism as before: supabase-js does not throw on a
-- Postgrest/constraint error by default, and logStop() only destructures
-- `data` from the insert response. Net effect since 2026-08-21: every
-- per-agent kill-switch block and every per-agent spend-cap block has
-- produced NO agent_decisions row at all -- no decisionId, no signed
-- receipt, nothing in the audit trail -- for exactly the two block types
-- Wave 5 session 1 was built to make auditable per-agent in the first
-- place. The live gate.ok/verdict/reason still worked correctly in the
-- moment (the caller sees the block), but the persisted audit trail was
-- empty, same as the original bug.
--
-- New migration rather than editing either prior fix in place, following
-- 20260818020115's own stated convention: migrations are immutable once
-- committed.
ALTER TABLE public.agent_decisions
  DROP CONSTRAINT IF EXISTS agent_decisions_source_check;

ALTER TABLE public.agent_decisions
  ADD CONSTRAINT agent_decisions_source_check CHECK (
    source IN (
      'model',
      'human_override',
      'kill_switch',
      'ai_spend_cap',
      'agent_kill_switch',
      'agent_ai_spend_cap',
      'hard_rule',
      'circuit_breaker',
      'circuit_breaker_trip',
      'safety_scanner',
      'anomaly_detector',
      'gate_error'
    )
  );
