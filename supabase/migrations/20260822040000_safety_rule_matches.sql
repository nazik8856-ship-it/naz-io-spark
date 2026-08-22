-- 2026-08-22 plan item 6: rule effectiveness extended to safety rules.
--
-- Real gap found while building this: hard_rules got a clean live-match
-- linkage in Wave 5 session 2 (agent_decisions.hard_rule_id) so the
-- dead-rule finder could ask "has this rule enforced anything in 30
-- days" from real data. Safety rules never got the equivalent -- a LIVE
-- custom safety rule match is only ever recorded as free text inside
-- agent_decisions.reasoning ("Matched: <name> on <field>"), which the
-- dead-rule finder can't query against by rule id. This closes that gap
-- the same way item 5 closed the shadow-hit gap: a real linking table.
--
-- Builtin rules (id like 'builtin:secret_key') are deliberately never
-- written here -- they're not deletable/manageable rows in safety_rules,
-- so "is this builtin rule dead" isn't a meaningful question the way it
-- is for a customer's own custom rule.
CREATE TABLE public.safety_rule_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.safety_rules(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.agent_decisions(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.safety_rule_matches TO authenticated;
GRANT ALL ON public.safety_rule_matches TO service_role;

ALTER TABLE public.safety_rule_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their safety rule matches"
  ON public.safety_rule_matches FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX safety_rule_matches_rule_idx
  ON public.safety_rule_matches (rule_id, created_at DESC);
