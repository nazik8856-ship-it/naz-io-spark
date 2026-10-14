-- Workflow branching: a step can run only when an earlier step's result says so, and a step
-- whose branch is not taken ends as 'skipped'.
ALTER TABLE public.outer_control_sessions ADD COLUMN condition jsonb;

ALTER TABLE public.outer_control_sessions DROP CONSTRAINT outer_control_sessions_status_check;
ALTER TABLE public.outer_control_sessions ADD CONSTRAINT outer_control_sessions_status_check
  CHECK (status IN ('queued', 'running', 'awaiting_human', 'completed', 'rejected', 'failed', 'cancelled', 'stopped', 'skipped'));
