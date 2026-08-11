CREATE TABLE public.action_reversals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.agent_decisions(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  provider text,
  tool text NOT NULL,
  reversible boolean NOT NULL DEFAULT false,
  undo_kind text NOT NULL DEFAULT 'none',
  undo_effect text,
  irreversible_reason text,
  ref text,
  undo_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'available',
  summary text,
  error text,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX action_reversals_user_created_idx ON public.action_reversals (user_id, created_at DESC);
CREATE INDEX action_reversals_decision_idx ON public.action_reversals (decision_id);

GRANT SELECT ON public.action_reversals TO authenticated;
GRANT ALL ON public.action_reversals TO service_role;

ALTER TABLE public.action_reversals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own action reversals"
  ON public.action_reversals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER action_reversals_updated_at
  BEFORE UPDATE ON public.action_reversals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();