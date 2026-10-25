-- Meaning rules: rules written in plain words ("Never promise a delivery date") that an AI judge checks each Outer Control reply
-- against. The judge must quote the words that break a rule; a finding without a real quote is thrown away. The deterministic
-- rules are checked first and stay enforced; a meaning rule can only make a decision stricter. project_id null: the whole
-- account; otherwise one imported project. Written only by edge functions (service role); the account's members can read them.
CREATE TABLE IF NOT EXISTS public.meaning_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.imported_projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 500),
  action text NOT NULL CHECK (action IN ('remove', 'block', 'approval')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meaning_rules_user_idx ON public.meaning_rules (user_id, project_id);

ALTER TABLE public.meaning_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read their meaning rules" ON public.meaning_rules;
CREATE POLICY "Owners read their meaning rules" ON public.meaning_rules FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Team members read the owner's meaning rules" ON public.meaning_rules;
CREATE POLICY "Team members read the owner's meaning rules" ON public.meaning_rules FOR SELECT USING (is_account_member(user_id));
REVOKE ALL ON TABLE public.meaning_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.meaning_rules TO authenticated;
GRANT ALL ON TABLE public.meaning_rules TO service_role;
