-- "Knowledge & autonomy" plan, item 12: let a caller link a sequence of
-- related actions into one plan (across one or more requests), so an
-- earlier BLOCKED step in the same plan can pull a later step that would
-- have auto-resolved toward a genuine human escalation instead. Purely an
-- opaque, caller-chosen tag -- NazAI never invents or interprets its
-- value, only looks up "what else in this plan has already happened,"
-- the exact same shape idempotency_key already has on pending_approvals.
ALTER TABLE public.agent_decisions ADD COLUMN IF NOT EXISTS plan_id text NULL;
ALTER TABLE public.pending_approvals ADD COLUMN IF NOT EXISTS plan_id text NULL;

-- Partial index: only decisions that actually name a plan are ever looked
-- up this way (the plan-escalation check in createPendingApproval), so a
-- full-table index over every plan_id-less row would be pure overhead.
CREATE INDEX IF NOT EXISTS agent_decisions_user_plan_idx
  ON public.agent_decisions (user_id, plan_id)
  WHERE plan_id IS NOT NULL;

COMMENT ON COLUMN public.agent_decisions.plan_id IS
  'Opaque caller-supplied tag linking this decision to other actions (across one or more Control API requests) as steps in the same real-world sequence. NULL for every decision that never named one.';
COMMENT ON COLUMN public.pending_approvals.plan_id IS
  'Mirrors the originating decision''s plan_id, so a human reviewing this escalation can see it was pulled in specifically because an earlier step in the same plan was blocked.';
