CREATE TABLE public.agent_decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid,
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_index integer,
  decision text NOT NULL,
  reasoning text NOT NULL DEFAULT '',
  alternatives_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score integer NOT NULL DEFAULT 50,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_decisions TO authenticated;
GRANT ALL ON public.agent_decisions TO service_role;

ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own agent decisions"
ON public.agent_decisions FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_agent_decisions_run ON public.agent_decisions(agent_run_id, created_at);
CREATE INDEX idx_agent_decisions_user ON public.agent_decisions(user_id, created_at DESC);

ALTER TABLE public.agent_decisions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_decisions;