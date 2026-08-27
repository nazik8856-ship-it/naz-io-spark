-- "Real precedent memory" plan, item 3: the real semantic-similarity
-- search itself. pgvector's nearest-neighbor ordering (`<=>`, cosine
-- distance) isn't expressible through PostgREST's plain `.order()` /
-- `.filter()` fluent API, so this is a real SQL function, called via
-- admin.rpc() the same way get_active_policy_version/record_ai_spend
-- already are.
--
-- Always scoped to exactly one api_key_id (this round's own confirmed
-- boundary: precedent for one external caller, never blended across
-- keys or accounts) and excludes one decision explicitly -- the action
-- currently being judged may already have its own embedding row (item
-- 1 embeds it before createPendingApproval ever runs), and matching
-- against itself at ~100% similarity would be meaningless, misleading
-- "precedent."
--
-- Service-role only, same gating as resolve_api_key/record_ai_spend/
-- verify_decision_signature -- no authenticated user ever has a
-- legitimate reason to call this directly.
CREATE OR REPLACE FUNCTION public.search_decision_precedent(
  _api_key_id uuid,
  _embedding vector(768),
  _exclude_decision_id uuid DEFAULT NULL,
  _limit int DEFAULT 8
)
RETURNS TABLE(decision_id uuid, action_type text, provider text, similarity float, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT
    de.decision_id,
    de.action_type,
    de.provider,
    (1 - (de.embedding <=> _embedding))::float AS similarity,
    de.created_at
  FROM public.decision_embeddings de
  WHERE de.api_key_id = _api_key_id
    AND (_exclude_decision_id IS NULL OR de.decision_id <> _exclude_decision_id)
  ORDER BY de.embedding <=> _embedding
  LIMIT GREATEST(1, LEAST(_limit, 50));
END;
$$;

REVOKE ALL ON FUNCTION public.search_decision_precedent(uuid, vector, uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_decision_precedent(uuid, vector, uuid, int) TO service_role;
