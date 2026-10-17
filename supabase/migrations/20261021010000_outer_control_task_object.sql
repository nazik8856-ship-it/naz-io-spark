-- Outer Control: the Task object.
--
-- A Task is one request carried out as an ordered list of steps against one or more tools. It is stored in
-- outer_control_workflows (the steps are the outer_control_sessions rows with that workflow_id), so no second
-- system is added: every run, single or multi-tool, now has a Task row that holds the request, the state and the
-- final controlled result. Every result passed from one step to the next is logged in outer_control_task_handoffs.
-- A NazAI-generated agent can be a step: it is an external_tools row with agent_id set.

ALTER TABLE public.outer_control_workflows
  -- 'single' = a one-tool run wrapped in a Task; 'chain' = several steps.
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chain' CHECK (kind IN ('single', 'chain')),
  -- Set when the request came from an external agent through the relay endpoint instead of from the owner.
  ADD COLUMN IF NOT EXISTS origin jsonb,
  ADD COLUMN IF NOT EXISTS current_leg integer,
  ADD COLUMN IF NOT EXISTS steps_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS steps_done integer NOT NULL DEFAULT 0,
  -- The controlled output of the last completed step; set only when the Task completed.
  ADD COLUMN IF NOT EXISTS final_output text,
  ADD COLUMN IF NOT EXISTS final_leg integer,
  -- Set when the Task stopped on a failure or a rule: which step, and why.
  ADD COLUMN IF NOT EXISTS failed_leg integer,
  ADD COLUMN IF NOT EXISTS stop_reason text;

CREATE TABLE IF NOT EXISTS public.outer_control_task_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.outer_control_workflows(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- NULL when the result came from an external agent through the relay endpoint.
  from_leg integer,
  from_label text NOT NULL,
  to_leg integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'modified', 'blocked')),
  -- Rules that cleaned or stopped the result.
  rules text[] NOT NULL DEFAULT '{}',
  chars integer NOT NULL DEFAULT 0,
  -- SHA-256 of the text handed over (the text itself is in the receiving step's context).
  text_sha256 text,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outer_control_task_handoffs_task_idx ON public.outer_control_task_handoffs (task_id, created_at);

ALTER TABLE public.outer_control_task_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their task hand-offs" ON public.outer_control_task_handoffs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Team members read the owner's task hand-offs" ON public.outer_control_task_handoffs FOR SELECT USING (is_account_member(user_id));
GRANT SELECT ON public.outer_control_task_handoffs TO authenticated;
GRANT ALL ON public.outer_control_task_handoffs TO service_role;

-- A NazAI agent as a step: the tool row points at the agent (endpoint_url is a placeholder, never fetched).
ALTER TABLE public.external_tools
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS external_tools_agent_idx ON public.external_tools (agent_id) WHERE agent_id IS NOT NULL;
GRANT SELECT (agent_id) ON public.external_tools TO authenticated;
