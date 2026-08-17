-- Tracks whether an approved action has actually been carried out, so
-- POST /control-engine/approvals/:id/execute can claim execution atomically
-- and refuse a second run — a double-click, a retried request, or two open
-- tabs must never send the same email / post the same message / create the
-- same draft order twice.
ALTER TABLE public.pending_approvals
  ADD COLUMN executed_at timestamptz;

CREATE INDEX idx_pending_approvals_executed_at
  ON public.pending_approvals (id)
  WHERE executed_at IS NULL;
