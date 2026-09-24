-- Pillar 3 top-10 item 6: new agent_decisions.source value for the fix in
-- agent-runtime/index.ts's control-engine fallback path -- see
-- control-gate.ts's AGENT_DECISION_SOURCES for the full rationale.
ALTER TABLE public.agent_decisions DROP CONSTRAINT IF EXISTS agent_decisions_source_check;

ALTER TABLE public.agent_decisions
  ADD CONSTRAINT agent_decisions_source_check
  CHECK (source = ANY (ARRAY[
    'model', 'human_override', 'kill_switch', 'ai_spend_cap', 'agent_kill_switch',
    'agent_ai_spend_cap', 'hard_rule', 'circuit_breaker', 'circuit_breaker_trip',
    'safety_scanner', 'anomaly_detector', 'gate_error', 'gate_error_fail_open',
    'external_api', 'platform_kill_switch', 'platform_kill_switch_flip',
    'kill_switch_flip', 'consequential_sweeps_paused_flip', 'control_engine_unreachable'
  ]::text[]));
