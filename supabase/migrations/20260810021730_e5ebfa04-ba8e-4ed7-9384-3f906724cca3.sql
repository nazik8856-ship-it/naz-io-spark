CREATE TABLE public.pending_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.agent_decisions(id),
  requester_id uuid,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  provider text NOT NULL DEFAULT 'unknown',
  description text NOT NULL DEFAULT '',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL DEFAULT '',
  risk_tier text NOT NULL DEFAULT 'medium',
  origin text NOT NULL DEFAULT 'control-engine',
  approver_role text NOT NULL DEFAULT 'owner',
  required_approvals integer NOT NULL DEFAULT 1,
  approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  comment text,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.pending_approvals TO authenticated;
GRANT ALL ON public.pending_approvals TO service_role;
ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own approvals read" ON public.pending_approvals FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own approvals update" ON public.pending_approvals FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own approvals insert" ON public.pending_approvals FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE INDEX pending_approvals_user_status_idx ON public.pending_approvals (user_id, status, created_at DESC);

CREATE TABLE public.safety_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'custom',
  pattern text NOT NULL,
  severity text NOT NULL DEFAULT 'require_approval',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_rules TO authenticated;
GRANT ALL ON public.safety_rules TO service_role;
ALTER TABLE public.safety_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own safety rules" ON public.safety_rules FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER safety_rules_updated_at BEFORE UPDATE ON public.safety_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();