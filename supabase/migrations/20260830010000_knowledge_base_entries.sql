-- "Knowledge & autonomy" plan, item 1: give NazAI a real, editable
-- knowledge base for judging decisions -- an account can tell NazAI a
-- fact, a definition, or a standing instruction in plain English
-- ("our refund policy is 30 days," "'VIP' means a customer on our
-- Enterprise plan") that the model actually reads when judging a
-- borderline case. Distinct from hard_rules/safety_rules (deterministic
-- pattern rules the LLM never reads or interprets) and from
-- business_profiles (auto-researched company info, not authored
-- guidance) -- confirmed by research that nothing like this exists
-- anywhere in this codebase today.
--
-- Mirrors hard_rules' own scoping shape exactly: action_type_pattern and
-- provider are both optional (null means "applies to everything" for
-- that dimension), so an account already familiar with hard rules
-- understands this immediately.
CREATE TABLE IF NOT EXISTS public.knowledge_base_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_text text NOT NULL,
  action_type_pattern text,
  provider text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_base_entries_user_idx
  ON public.knowledge_base_entries (user_id, enabled);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_base_entries TO authenticated;
GRANT ALL ON public.knowledge_base_entries TO service_role;

ALTER TABLE public.knowledge_base_entries ENABLE ROW LEVEL SECURITY;

-- Same 'policy' permission category as hard_rules/safety_rules/
-- policy_versions (20260827040000_permission_scoped_write_policies.sql)
-- -- a knowledge-base entry shapes AI judgment exactly the way those do.
CREATE POLICY "Team owners can manage owner's knowledge base entries" ON public.knowledge_base_entries
  FOR ALL TO authenticated
  USING (public.is_account_member(user_id, 'owner', 'policy'))
  WITH CHECK (public.is_account_member(user_id, 'owner', 'policy'));

CREATE POLICY "Team members can view owner's knowledge base entries" ON public.knowledge_base_entries
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_account_member(user_id));

-- Same generic config-change logger every other policy-shaping table
-- already has (20260819010000_config_changes.sql) -- every insert/
-- update/delete here shows up in the account's own change log for free.
CREATE TRIGGER log_knowledge_base_entries_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.knowledge_base_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();
