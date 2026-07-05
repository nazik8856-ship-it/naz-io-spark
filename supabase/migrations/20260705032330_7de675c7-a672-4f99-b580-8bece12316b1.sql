CREATE TABLE public.integration_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  provider text NOT NULL,
  kind text NOT NULL DEFAULT 'summary',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_snapshots_lookup_idx
  ON public.integration_snapshots (user_id, provider, agent_id, fetched_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_snapshots TO authenticated;
GRANT ALL ON public.integration_snapshots TO service_role;

ALTER TABLE public.integration_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners manage their integration snapshots"
  ON public.integration_snapshots
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);