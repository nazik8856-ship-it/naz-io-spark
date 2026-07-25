
CREATE TABLE public.scenario_simulations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.scenario_simulations TO authenticated;
GRANT ALL ON public.scenario_simulations TO service_role;
ALTER TABLE public.scenario_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_select" ON public.scenario_simulations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own_insert" ON public.scenario_simulations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_delete" ON public.scenario_simulations FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX scenario_simulations_user_created_idx ON public.scenario_simulations (user_id, created_at DESC);
