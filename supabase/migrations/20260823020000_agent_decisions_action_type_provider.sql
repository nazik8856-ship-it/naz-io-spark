-- 2026-08-23 plan item 2: structured action_type/provider columns on
-- agent_decisions. Today every real value written by the gate is only
-- available embedded in the free-text `decision` column (e.g. "BLOCK
-- send_email (Gmail)"), which several tools already have to regex-parse
-- back out (roi-report.ts's classifyDecisionOutcome parses the verdict
-- verb the same way). This blocks or complicates a filterable decision
-- history and any future real-traffic policy replay.
--
-- Nullable, not backfilled -- historical rows before this migration stay
-- null; only go-forward inserts populate them. control-gate.ts's logStop()
-- and decision-scoring.ts's logDecision() already have both values in
-- scope at every insert site, so this is a pure write-path addition, not
-- new logic.
ALTER TABLE public.agent_decisions
  ADD COLUMN action_type text,
  ADD COLUMN provider text;

CREATE INDEX idx_agent_decisions_action_type ON public.agent_decisions (user_id, action_type) WHERE action_type IS NOT NULL;
CREATE INDEX idx_agent_decisions_provider ON public.agent_decisions (user_id, provider) WHERE provider IS NOT NULL;
