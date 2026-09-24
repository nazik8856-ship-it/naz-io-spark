-- Pillar 2 top-10 item 8: a "deferred" verdict's rich explanation (why not
-- now, what would change it, improvement steps, reconsider when) was built
-- in control-engine/index.ts and returned in the live chat response's
-- `deferred` object, but never persisted anywhere -- gone the moment the
-- turn ends. Decision History/ControlPendingDecisions/the Control API's
-- /explain endpoint have no way to ever show it again.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS deferred_detail jsonb;

COMMENT ON COLUMN public.agent_decisions.deferred_detail IS
  'Only set when decision starts with DEFERRED. Shape: {why_not_now, what_would_change_it, improvement_steps: string[], reconsider_when}. Written once at insert time, same as every other narrative column on this append-only table.';
