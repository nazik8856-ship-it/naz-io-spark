-- "Own decision-making machine" plan, item 178: /respond's embeddings now
-- come from Supabase's own built-in gte-small inference session
-- (_shared/local-embeddings.ts) instead of the Lovable AI gateway --
-- zero external dependency, zero cost, no API key. gte-small outputs
-- 384-dimension vectors, not the 768 the old google/text-embedding-004
-- model produced, so every column and RPC signature storing/accepting a
-- /respond embedding needs to move to vector(384). Scoped strictly to
-- the two tables /respond itself owns (api_key_context_entries,
-- api_response_cache) -- decision_embeddings (the separate judgment/
-- precedent system) is deliberately untouched here; sharing embeddings
-- across that system too is real, but later, more careful follow-up
-- work (item 178's own note), not a same-day migration of already-live
-- precedent data.
--
-- Existing embedding values are from a different model entirely (not
-- just a different dimension) -- semantically incompatible, not
-- reinterpretable -- so they're reset to NULL rather than converted.
-- Both tables are brand new (shipped this week) with no real customer
-- data yet, so this is a clean reset, not a destructive migration of
-- anything in real use. Callers already handle a NULL embedding
-- gracefully (response-context.ts's own retrieval falls back to loading
-- every enabled entry; response-cache.ts's near-duplicate lookup simply
-- finds nothing) -- re-embedding happens naturally the next time each
-- row is touched by the (now local, free) embedding call.
ALTER TABLE public.api_key_context_entries
  ALTER COLUMN embedding TYPE vector(384) USING NULL;

ALTER TABLE public.api_response_cache
  ALTER COLUMN embedding TYPE vector(384) USING NULL;

DROP FUNCTION IF EXISTS public.search_response_context(uuid, vector, int);

CREATE FUNCTION public.search_response_context(
  _api_key_id uuid,
  _embedding vector(384),
  _limit int DEFAULT 8
)
RETURNS TABLE(id uuid, entry_text text, similarity float)
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
    e.id,
    e.entry_text,
    (1 - (e.embedding <=> _embedding))::float AS similarity
  FROM public.api_key_context_entries e
  WHERE e.api_key_id = _api_key_id
    AND e.enabled = true
    AND e.embedding IS NOT NULL
  ORDER BY e.embedding <=> _embedding
  LIMIT GREATEST(1, LEAST(_limit, 50));
END;
$$;

REVOKE ALL ON FUNCTION public.search_response_context(uuid, vector, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_response_context(uuid, vector, int) TO service_role;

DROP FUNCTION IF EXISTS public.search_response_cache(uuid, vector, int);

CREATE FUNCTION public.search_response_cache(
  _api_key_id uuid,
  _embedding vector(384),
  _limit int DEFAULT 3
)
RETURNS TABLE(answer text, sources jsonb, confidence text, similarity float)
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
    c.answer,
    c.sources,
    c.confidence,
    (1 - (c.embedding <=> _embedding))::float AS similarity
  FROM public.api_response_cache c
  WHERE c.api_key_id = _api_key_id
    AND c.embedding IS NOT NULL
    AND c.expires_at > now()
  ORDER BY c.embedding <=> _embedding
  LIMIT GREATEST(1, LEAST(_limit, 20));
END;
$$;

REVOKE ALL ON FUNCTION public.search_response_cache(uuid, vector, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_response_cache(uuid, vector, int) TO service_role;
