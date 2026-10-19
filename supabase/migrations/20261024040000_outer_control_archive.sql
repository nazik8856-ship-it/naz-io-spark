-- Outer Control: archive instead of delete. Nothing is ever deleted (history is the audit trail); an archived session or Task is simply
-- left out of the default list and can be shown again.
ALTER TABLE public.outer_control_sessions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.outer_control_workflows ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Older items recorded as "completed" before every completed item had to carry a verified final result have no such result, so they
-- show as Failed ("recorded as completed, but not accepted"). That is honest, but it buries the real history. They are archived, not
-- changed: status, output and everything else stay exactly as they were. (The completed-guard only looks at a change TO completed.)
UPDATE public.outer_control_sessions SET archived_at = now() WHERE status = 'completed' AND final_artifact IS NULL AND archived_at IS NULL;
UPDATE public.outer_control_workflows SET archived_at = now() WHERE status = 'completed' AND final_artifact IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS outer_control_sessions_archived_idx ON public.outer_control_sessions (user_id, archived_at);
CREATE INDEX IF NOT EXISTS outer_control_workflows_archived_idx ON public.outer_control_workflows (user_id, archived_at);
