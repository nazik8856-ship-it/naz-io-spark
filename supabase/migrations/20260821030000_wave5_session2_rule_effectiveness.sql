-- Wave 5, session 2: rule effectiveness / dead-rule finder.
--
-- Today, when a live hard rule matches and enforces an action, the
-- resulting agent_decisions row has source='hard_rule' and the rule's text
-- embedded in a free-text reason -- but nothing queryable links the
-- decision back to WHICH hard_rules row fired. A "which of my live rules
-- have never actually matched anything" finder needs that real linkage,
-- not a guess parsed out of free text.
ALTER TABLE public.agent_decisions
  ADD COLUMN hard_rule_id uuid REFERENCES public.hard_rules(id) ON DELETE SET NULL;

-- Partial: only decisions actually enforced by a hard rule have this set,
-- so the index stays small relative to the whole (unbounded) decisions log.
CREATE INDEX idx_agent_decisions_hard_rule
  ON public.agent_decisions (hard_rule_id, created_at DESC)
  WHERE hard_rule_id IS NOT NULL;
