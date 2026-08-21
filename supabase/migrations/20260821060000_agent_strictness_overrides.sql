-- Wave 5 session 1 leftover, closed out: per-agent strictness override.
--
-- This was listed as part of session 1's "load-bearing core" back on
-- 2026-08-20 but was never actually built -- hard rules, safety rules and
-- the spend cap all got real per-agent scoping that day, but strictness
-- was left reading only profiles.control_strictness (account-wide),
-- with no override table and no agentId parameter anywhere in
-- decision-scoring.ts's loadStrictness(). Found and closed while building
-- the effective-policy-per-agent view, which needs a real per-agent
-- strictness value to show, not a copy-paste of the account default.
CREATE TABLE public.agent_strictness_overrides (
  agent_id uuid PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strictness text NOT NULL CHECK (strictness IN ('loose', 'balanced', 'strict')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_strictness_overrides_user ON public.agent_strictness_overrides (user_id);

CREATE TRIGGER agent_strictness_overrides_updated_at
  BEFORE UPDATE ON public.agent_strictness_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_strictness_overrides TO authenticated;
GRANT ALL ON public.agent_strictness_overrides TO service_role;

ALTER TABLE public.agent_strictness_overrides ENABLE ROW LEVEL SECURITY;

-- Same three-tier access as every other per-agent policy table this
-- session (hard_rules/safety_rules/ai_spend_caps): the account owner
-- manages their own; any active team member can read; an active
-- owner-role team member can also write (mirrors RBAC Phase 3's
-- additive-policy pattern exactly).
CREATE POLICY "own agent strictness overrides" ON public.agent_strictness_overrides
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Team members can view owner's agent strictness overrides" ON public.agent_strictness_overrides
  FOR SELECT TO authenticated
  USING (public.is_account_member(user_id));

CREATE POLICY "Team owners can manage owner's agent strictness overrides" ON public.agent_strictness_overrides
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner'))
  WITH CHECK (public.is_account_member(user_id, 'owner'));

-- Settings change log (Wave 3): audit who overrides an agent's strictness
-- and when, same as every other governance-setting table.
CREATE TRIGGER log_agent_strictness_overrides_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.agent_strictness_overrides
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();
