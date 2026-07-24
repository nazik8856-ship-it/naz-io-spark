
CREATE TABLE public.org_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  insight TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pattern',
  confidence TEXT NOT NULL DEFAULT 'medium',
  evidence_count INTEGER NOT NULL DEFAULT 1,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_agent_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_insights TO authenticated;
GRANT ALL ON public.org_insights TO service_role;

ALTER TABLE public.org_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own org insights"
  ON public.org_insights FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX org_insights_user_confirmed_idx
  ON public.org_insights (user_id, last_confirmed_at DESC);

CREATE TRIGGER update_org_insights_updated_at
  BEFORE UPDATE ON public.org_insights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
