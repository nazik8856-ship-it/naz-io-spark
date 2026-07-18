-- Daily action cap column
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS daily_action_cap integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS client_write_mode text NOT NULL DEFAULT 'hybrid'
    CHECK (client_write_mode IN ('free', 'approval', 'hybrid'));

-- Per-agent client CRM table
CREATE TABLE IF NOT EXISTS public.agent_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text,
  email text,
  company text,
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  interaction_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_clients_agent_email_uniq
  ON public.agent_clients (agent_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_clients_agent_id_idx ON public.agent_clients (agent_id);
CREATE INDEX IF NOT EXISTS agent_clients_user_id_idx ON public.agent_clients (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_clients TO authenticated;
GRANT ALL ON public.agent_clients TO service_role;

ALTER TABLE public.agent_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their agent clients"
  ON public.agent_clients
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER agent_clients_set_updated_at
  BEFORE UPDATE ON public.agent_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();