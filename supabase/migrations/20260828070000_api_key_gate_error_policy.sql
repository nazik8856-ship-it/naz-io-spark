-- "Zero human review" plan, item 8: today, if the control gate itself
-- throws an unexpected error (a DB hiccup, a bug, anything not a
-- deliberate kill switch) every single verdict comes back BLOCK, with no
-- exception (control-gate.ts's outer fail-closed catch, unconditional).
-- For a company that's fully automated and depends on NazAI's own
-- uptime, being blocked by NazAI's OWN outage might be worse for their
-- business than a clearly-labeled, audited "let it through" default.
-- Default stays 'block' -- this is opt-in per key, never a platform-wide
-- change in posture.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS on_gate_error text NOT NULL DEFAULT 'block'
    CHECK (on_gate_error IN ('block', 'allow'));

-- New AgentDecisionSource value BEFORE control-gate.ts ever writes a row
-- with it -- this project has hit the "used in code before the CHECK
-- constraint was extended" bug four separate times already
-- (agent_decisions_source_check's own extension history); deliberately a
-- DIFFERENT value from plain 'gate_error', not a boolean flag alongside
-- it, so a fail-open override is never silently blended in with a normal
-- fail-closed gate error in any report or audit query that groups by
-- source.
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
      'gate_error_fail_open'
    )
  );

-- A fail-OPEN outcome is operationally far more significant than a
-- normal fail-closed gate_error incident (something ran UNJUDGED during
-- an outage, not merely blocked) -- must never be indistinguishable from
-- an ordinary gate_error incident in a report, so it's a distinct
-- IncidentKind too, same as it's a distinct AgentDecisionSource above.
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
      'control_api_abuse',
      'gate_error_fail_open'
    )
  );
