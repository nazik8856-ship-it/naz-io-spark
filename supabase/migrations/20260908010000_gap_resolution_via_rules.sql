-- "Own decision-making machine" plan, integration round: gap auto-
-- resolution (items 179-180) only ever watched for a NEW CONTEXT ENTRY
-- to decide a content gap was fixed -- never a new RESPONSE RULE (item
-- 177), even though a rule is often the more natural fix for a
-- recurring, FAQ-shaped gap (that's the entire reason the rule tier
-- exists). An account owner who fixed a gap by adding a rule instead of
-- a context entry would see it marked "unresolved" forever, even though
-- /respond has been answering it correctly ever since the rule was
-- added -- two things this codebase built never talking to each other.
--
-- resolved_by_rule_id mirrors resolved_by_entry_id's exact shape
-- (nullable, ON DELETE SET NULL, best-effort cleared by the owning
-- DELETE endpoint when the resolving row goes away -- see
-- api-keys/index.ts's response-rules DELETE handler). Exactly one of
-- resolved_by_entry_id / resolved_by_rule_id is set on a resolved gap,
-- never both -- content-gap-triage-sweep's own resolution phase checks
-- rules first (free, synchronous, no embedding needed) before falling
-- through to context retrieval, the same rule-tier-before-retrieval-
-- tier precedence /respond itself already uses.
ALTER TABLE public.api_response_generations
  ADD COLUMN resolved_by_rule_id uuid REFERENCES public.api_key_response_rules(id) ON DELETE SET NULL;

-- Candidate query extended with an OR: a gap now qualifies for a
-- resolution recheck if its key has gained EITHER a new embedded
-- context entry OR a new enabled response rule since the gap was
-- recorded. Still the same "nothing new to check against -> skip
-- entirely, cheaply" posture as before -- an unresolved gap with
-- neither is left alone rather than re-checked every single sweep tick
-- forever.
CREATE OR REPLACE FUNCTION public.list_resolvable_gap_candidates(_limit int DEFAULT 200)
RETURNS TABLE(id uuid, api_key_id uuid, message text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.id, g.api_key_id, g.message
  FROM public.api_response_generations g
  WHERE g.grounding_check_intervened = true
    AND g.resolved_at IS NULL
    AND g.is_test = false
    AND (
      EXISTS (
        SELECT 1 FROM public.api_key_context_entries e
        WHERE e.api_key_id = g.api_key_id AND e.created_at > g.created_at AND e.embedding IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.api_key_response_rules r
        WHERE r.api_key_id = g.api_key_id AND r.created_at > g.created_at AND r.enabled = true
      )
    )
  ORDER BY g.created_at ASC
  LIMIT GREATEST(1, LEAST(_limit, 500));
$$;

REVOKE ALL ON FUNCTION public.list_resolvable_gap_candidates(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_resolvable_gap_candidates(int) TO service_role;
