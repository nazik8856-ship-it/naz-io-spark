-- CRITICAL FIX: agent_decisions_source_check only allowed 'model' and
-- 'human_override', but the deterministic control gate (control-gate.ts)
-- has been inserting rows with source values the constraint never covered:
-- 'kill_switch', 'ai_spend_cap', 'hard_rule', 'circuit_breaker',
-- 'circuit_breaker_trip', 'safety_scanner', 'anomaly_detector'.
--
-- supabase-js does not throw on a Postgrest/constraint error by default —
-- runControlGate's logStop() only destructures `data` from the insert
-- response and swallows the rest, so every one of these inserts has been
-- failing SILENTLY. Net effect: no agent_decisions row (and therefore no
-- signed decision receipt) has ever actually been created for a kill-switch
-- block, a spend-cap block, a hard-rule block/approval, a circuit-breaker
-- block/trip, a safety-scanner block/approval, or an anomaly-detector hold —
-- exactly the deterministic, non-model layers this whole system exists to
-- make auditable. The live gate.ok/verdict/reason still worked correctly in
-- the moment (the caller sees the block), but the persisted audit trail for
-- all of it was empty.
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
      'anomaly_detector'
    )
  );
