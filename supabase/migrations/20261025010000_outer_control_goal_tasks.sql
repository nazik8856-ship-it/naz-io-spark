-- Outer Control: goal-driven Tasks. A Task can now be started from a goal and done criteria (mode 'goal') instead of a fixed list
-- of steps (mode 'steps', every existing Task). After each round the controlled results are checked against the criteria and the
-- next question is written from what is still missing; the Task is blocked, with a reason, when it cannot go on.
ALTER TABLE public.outer_control_workflows
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'steps',
  ADD COLUMN IF NOT EXISTS goal_pool jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS done_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS criteria_state jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_rounds integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rounds_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goal_judged_leg integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goal_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

ALTER TABLE public.outer_control_workflows DROP CONSTRAINT IF EXISTS outer_control_workflows_mode_check;
ALTER TABLE public.outer_control_workflows
  ADD CONSTRAINT outer_control_workflows_mode_check CHECK (mode IN ('steps', 'goal'));
ALTER TABLE public.outer_control_workflows DROP CONSTRAINT IF EXISTS outer_control_workflows_max_rounds_check;
ALTER TABLE public.outer_control_workflows
  ADD CONSTRAINT outer_control_workflows_max_rounds_check CHECK (max_rounds BETWEEN 1 AND 10);

-- A run of a NazAI agent that was started by an Outer Control Task says which Task and step started it, so Inner Control can show
-- the agent's actions as part of that Task.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS outer_task_id uuid,
  ADD COLUMN IF NOT EXISTS outer_session_id uuid;
CREATE INDEX IF NOT EXISTS agent_runs_outer_task_idx ON public.agent_runs (outer_task_id) WHERE outer_task_id IS NOT NULL;

-- When a goal Task became blocked (a person has a week to decide, as with any other wait).
ALTER TABLE public.outer_control_workflows ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
