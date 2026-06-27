
CREATE TABLE IF NOT EXISTS public.agent_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID,
  provider TEXT NOT NULL,
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, agent_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_integrations TO authenticated;
GRANT ALL ON public.agent_integrations TO service_role;

ALTER TABLE public.agent_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own integrations"
  ON public.agent_integrations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_agent_integrations_updated_at
  BEFORE UPDATE ON public.agent_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
