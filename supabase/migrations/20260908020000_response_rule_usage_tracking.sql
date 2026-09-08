-- "Own decision-making machine" plan, integration round: item 181 gave
-- api_key_context_entries use_count/last_used_at so an account owner can
-- see which context entries actually pull weight in real answers. Rules
-- (item 177) never got the same treatment -- an account owner has zero
-- visibility into whether ANY of their rules ever fire, even though
-- rules now also drive gap resolution (see
-- 20260908010000_gap_resolution_via_rules.sql) and the overlap warning.
-- Same "surface it, let the owner decide" posture as item 181, and as
-- api_keys.last_used_at before that.
--
-- Simpler than item 181's own version of this: a rule is NEVER cached
-- (item 174's storeCachedResponse is only ever called from the
-- retrieval-tier path in control-api/index.ts, never the rule-tier
-- branch -- see that file's own comment on why), so there is exactly one
-- place a rule is ever actually used to answer a real message: the
-- rule-tier match in /respond itself. No cache-hit call sites to wire up
-- the way context-entry usage tracking needed three.
ALTER TABLE public.api_key_response_rules
  ADD COLUMN use_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_used_at timestamptz;

-- Called from control-api/index.ts's /respond handler, once per real
-- (non-test) call whose rule tier actually matched -- best-effort, never
-- allowed to block or fail the response that already succeeded. Same
-- SECURITY DEFINER + explicit auth.role() guard shape as
-- record_context_entry_usage (item 181) and every other service-role-
-- only write RPC in this codebase.
CREATE FUNCTION public.record_rule_usage(_rule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.api_key_response_rules
  SET use_count = use_count + 1, last_used_at = now()
  WHERE id = _rule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_rule_usage(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_rule_usage(uuid) TO service_role;
