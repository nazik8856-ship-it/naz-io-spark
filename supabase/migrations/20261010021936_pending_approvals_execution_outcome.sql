-- GAP 5 (Action Execution Feedback Loop, 2026-10-10): pending_approvals had
-- executed_at (when) but nothing for WHAT HAPPENED -- a successful execute's
-- summary/ref/url (control-engine/index.ts's /approvals/:id/execute) was
-- only ever returned transiently in the HTTP response, and a FAILED
-- execute's error wasn't persisted anywhere at all. outer_control_evaluations
-- already has execution_summary/execution_ref/execution_url columns for
-- exactly this; pending_approvals never got the equivalent, so a failed
-- execute looked identical to "nobody has tried yet" the moment the response
-- that carried the error was gone.
ALTER TABLE public.pending_approvals
  ADD COLUMN IF NOT EXISTS execution_summary text,
  ADD COLUMN IF NOT EXISTS execution_error text;
