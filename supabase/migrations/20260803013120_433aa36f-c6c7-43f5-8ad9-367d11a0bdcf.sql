CREATE TABLE public.decision_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES public.agent_decisions(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  provider text,
  linked_metric text NOT NULL,
  baseline_value numeric,
  result_value numeric,
  delta numeric,
  delta_pct numeric,
  direction text NOT NULL DEFAULT 'neutral' CHECK (direction IN ('positive','negative','neutral','unknown')),
  window_days integer NOT NULL DEFAULT 7,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  org_insight_id uuid REFERENCES public.org_insights(id) ON DELETE SET NULL,
  measured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, linked_metric, window_days)
);

CREATE INDEX idx_decision_outcomes_user ON public.decision_outcomes(user_id, measured_at DESC);
CREATE INDEX idx_decision_outcomes_decision ON public.decision_outcomes(decision_id);

GRANT SELECT, INSERT, UPDATE ON public.decision_outcomes TO authenticated;
GRANT ALL ON public.decision_outcomes TO service_role;

ALTER TABLE public.decision_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own decision outcomes"
  ON public.decision_outcomes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own decision outcomes"
  ON public.decision_outcomes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own decision outcomes"
  ON public.decision_outcomes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_decision_outcomes_updated_at
  BEFORE UPDATE ON public.decision_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();