-- Adding a new AgentDecisionSource value BEFORE any code logs a decision
-- with it -- this project has hit "used before the CHECK constraint knows
-- about it" repeatedly (documented in 20260827050000_platform_kill_switch.sql),
-- so this migration lands ahead of KillSwitchPanel.tsx's new sweeps-pause
-- toggle, mirroring kill_switch_flip/platform_kill_switch_flip exactly.
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
      'external_api',
      'platform_kill_switch',
      'platform_kill_switch_flip',
      'kill_switch_flip',
      'consequential_sweeps_paused_flip'
    )
  );
