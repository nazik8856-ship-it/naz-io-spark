
CREATE TABLE public.agent_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('report','digest','audit','plan')),
  body_markdown text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.agent_reports TO authenticated;
GRANT ALL ON public.agent_reports TO service_role;

ALTER TABLE public.agent_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own agent reports"
  ON public.agent_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own agent reports"
  ON public.agent_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX agent_reports_agent_idx
  ON public.agent_reports (agent_id, created_at DESC);

-- Support schedule_followup executor: let agent_runs represent a scheduled future run.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS instruction text;

CREATE INDEX IF NOT EXISTS agent_runs_scheduled_idx
  ON public.agent_runs (scheduled_for)
  WHERE status = 'scheduled';
