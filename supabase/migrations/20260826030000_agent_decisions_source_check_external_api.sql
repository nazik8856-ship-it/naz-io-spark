-- "Outer NazAI" plan, item 4: add 'external_api' to
-- agent_decisions_source_check BEFORE anything ever logs a decision with
-- that source.
--
-- This project has hit the exact same bug class twice already
-- (20260818015349, then again 20260823010000) -- a new AgentDecisionSource
-- value used in code without the CHECK constraint being extended first,
-- causing every insert with the new source to fail silently (supabase-js
-- does not throw on a constraint error by default, and every logStop()/
-- logDecision() call only destructures `data` from the insert response).
-- Doing this migration BEFORE control-api (item 5) ever writes a
-- source: 'external_api' row, rather than after, is the whole point.
--
-- Mirrors 20260823010000's exact DROP/ADD CONSTRAINT shape.
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
      'gate_error',
      'external_api'
    )
  );
