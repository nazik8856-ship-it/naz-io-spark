-- "gate_error_fail_open" (control-gate.ts's AGENT_DECISION_SOURCES, used when
-- an API key's on_gate_error policy is set to "allow") was never added to
-- this CHECK constraint -- the exact same class of bug this constraint's own
-- comment history already documents for "agent_kill_switch"/"agent_ai_spend_cap"
-- and "kill_switch_flip"/"platform_kill_switch_flip". supabase-js doesn't
-- throw on a constraint violation and control-gate.ts's insert here only
-- destructures `data`, so every fail-open gate-error decision has been
-- silently failing to log at all (confirmed live: zero rows exist with this
-- source, despite it being read by key-performance.ts, critical-alerts.ts,
-- incidents.ts, decision-explanation.ts, and platform-status.ts as if it
-- were a real, reachable value).
ALTER TABLE public.agent_decisions DROP CONSTRAINT agent_decisions_source_check;

ALTER TABLE public.agent_decisions ADD CONSTRAINT agent_decisions_source_check
  CHECK (source = ANY (ARRAY[
    'model'::text, 'human_override'::text, 'kill_switch'::text, 'ai_spend_cap'::text,
    'agent_kill_switch'::text, 'agent_ai_spend_cap'::text, 'hard_rule'::text,
    'circuit_breaker'::text, 'circuit_breaker_trip'::text, 'safety_scanner'::text,
    'anomaly_detector'::text, 'gate_error'::text, 'gate_error_fail_open'::text,
    'external_api'::text, 'platform_kill_switch'::text, 'platform_kill_switch_flip'::text,
    'kill_switch_flip'::text, 'consequential_sweeps_paused_flip'::text
  ]));
