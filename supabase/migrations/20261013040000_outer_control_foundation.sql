-- Outer Control foundation (intake, rules, decisions, modify, feedback).
--
-- safety_rules.redact: a block-severity custom rule can say "cut the matched
-- text out of the external AI's response" (verdict modify) instead of blocking
-- the whole response. Built-in secrets/pii rules already behave that way by
-- category; custom rules had no way to opt in.
ALTER TABLE public.safety_rules
  ADD COLUMN IF NOT EXISTS redact boolean NOT NULL DEFAULT false;

-- outer_control_evaluations:
--   changes        what Modify actually removed: [{rule_id,name,category,action,count}]
--   next_step      what the caller should do with this verdict: use_output | await_approval | discard
--   shadow_matches shadow-mode rules that WOULD have matched (never change the verdict)
--   approval_id    the pending_approvals row an escalate verdict created
--   external_id    caller-supplied id so a retried call returns the stored verdict instead of a duplicate
ALTER TABLE public.outer_control_evaluations
  ADD COLUMN IF NOT EXISTS changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_step text CHECK (next_step IS NULL OR next_step IN ('use_output', 'await_approval', 'discard')),
  ADD COLUMN IF NOT EXISTS shadow_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES public.pending_approvals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_id text CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 200);

CREATE UNIQUE INDEX IF NOT EXISTS outer_control_evaluations_external_id_uniq
  ON public.outer_control_evaluations (user_id, api_key_id, external_id)
  WHERE external_id IS NOT NULL;
