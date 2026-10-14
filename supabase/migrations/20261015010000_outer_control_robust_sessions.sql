-- Outer Control (active), robustness: workflows over several tools, a persistent
-- memory of decisions, recovery (fallback tool, delayed retry) and structured
-- hand-offs to a person.
--
-- All writes still go through the edge functions (service role); clients only read.

-- 1. A workflow groups several sessions ("legs"), each against one tool.
CREATE TABLE public.outer_control_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 1 AND 2000),
  context text CHECK (context IS NULL OR char_length(context) <= 8000),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'awaiting_human', 'completed', 'failed', 'cancelled')),
  summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX outer_control_workflows_user_idx ON public.outer_control_workflows (user_id, started_at DESC);
CREATE INDEX outer_control_workflows_open_idx ON public.outer_control_workflows (status) WHERE status IN ('running', 'awaiting_human');

-- 2. Sessions become legs of a workflow when workflow_id is set.
ALTER TABLE public.outer_control_sessions
  ADD COLUMN workflow_id uuid REFERENCES public.outer_control_workflows(id) ON DELETE CASCADE,
  ADD COLUMN leg_no integer,
  -- Leg numbers (of the same workflow) that must complete before this one starts.
  ADD COLUMN depends_on integer[] NOT NULL DEFAULT '{}',
  -- Tool to switch to once, if this leg's tool keeps failing.
  ADD COLUMN fallback_tool_id uuid REFERENCES public.external_tools(id) ON DELETE SET NULL,
  ADD COLUMN fallback_used boolean NOT NULL DEFAULT false,
  -- What to do when retries run out: ask a person ('handoff') or end the session ('reject').
  ADD COLUMN on_failure text NOT NULL DEFAULT 'handoff' CHECK (on_failure IN ('handoff', 'reject')),
  -- Do not contact the tool again before this time (rate limits, long back-offs).
  ADD COLUMN resume_at timestamptz,
  -- Attempts already spent on the step in progress before the last hand-off.
  ADD COLUMN attempt_base integer NOT NULL DEFAULT 0,
  -- The structured hand-off a person is looking at: {kind, title, summary, options[], recommended}.
  ADD COLUMN handoff jsonb;

ALTER TABLE public.outer_control_sessions DROP CONSTRAINT outer_control_sessions_status_check;
ALTER TABLE public.outer_control_sessions ADD CONSTRAINT outer_control_sessions_status_check
  CHECK (status IN ('queued', 'running', 'awaiting_human', 'completed', 'rejected', 'failed', 'cancelled', 'stopped'));
ALTER TABLE public.outer_control_sessions DROP CONSTRAINT outer_control_sessions_pending_kind_check;
ALTER TABLE public.outer_control_sessions ADD CONSTRAINT outer_control_sessions_pending_kind_check
  CHECK (pending_kind IS NULL OR pending_kind IN ('first_contact', 'contact_gate', 'reply_approval', 'question', 'handoff'));
CREATE INDEX outer_control_sessions_workflow_idx ON public.outer_control_sessions (workflow_id, leg_no) WHERE workflow_id IS NOT NULL;
CREATE INDEX outer_control_sessions_active_idx ON public.outer_control_sessions (status) WHERE status IN ('queued', 'running', 'awaiting_human');

-- 3. Memory of what was decided, changed and applied, so later steps stay consistent.
CREATE TABLE public.outer_control_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.outer_control_sessions(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.outer_control_workflows(id) ON DELETE CASCADE,
  step_no integer NOT NULL DEFAULT 0,
  kind text NOT NULL CHECK (kind IN ('rule', 'modification', 'rejection', 'recovery', 'human', 'plan')),
  rule_names text[] NOT NULL DEFAULT '{}',
  summary text NOT NULL CHECK (char_length(summary) <= 600),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outer_control_memory_session_idx ON public.outer_control_memory (session_id, created_at);
CREATE INDEX outer_control_memory_workflow_idx ON public.outer_control_memory (workflow_id, created_at) WHERE workflow_id IS NOT NULL;

ALTER TABLE public.outer_control_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outer_control_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their workflows" ON public.outer_control_workflows FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Team members read the owner's workflows" ON public.outer_control_workflows FOR SELECT USING (is_account_member(user_id));
CREATE POLICY "Owners read their control memory" ON public.outer_control_memory FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Team members read the owner's control memory" ON public.outer_control_memory FOR SELECT USING (is_account_member(user_id));
GRANT SELECT ON public.outer_control_workflows, public.outer_control_memory TO authenticated;
GRANT ALL ON public.outer_control_workflows, public.outer_control_memory TO service_role;
