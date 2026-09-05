-- "/respond" MVP backlog, item 174: response caching for repeated/near-
-- duplicate questions. A generated answer costs a real model call (twice,
-- counting the grounding check) every single time today, even when the
-- exact same question -- or a near-verbatim rephrasing -- was already
-- answered minutes ago. Two lookup paths, both scoped to one api_key_id
-- (never shared across keys, same isolation as api_key_context_entries):
--
--  * message_hash: an exact-match fast path that costs nothing to check
--    (no embedding call) -- covers the common "same FAQ question asked
--    again, verbatim" case.
--  * embedding: a near-duplicate path, compared via search_response_cache
--    below against whatever embedding of the incoming message context
--    retrieval (item 163) already computed -- reused, not a second paid
--    embedding call purely for caching.
--
-- Only ever written for a genuinely grounded answer (never the generic
-- "I don't have enough information" fallback) -- see the accompanying
-- control-api/index.ts change for why. expires_at gives every entry a
-- real TTL rather than caching forever, since the key's own context or
-- persona can change at any time.
CREATE TABLE IF NOT EXISTS public.api_response_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  message_hash text NOT NULL,
  message text NOT NULL CHECK (char_length(message) <= 500),
  embedding vector(768),
  answer text NOT NULL,
  sources jsonb,
  confidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Exact-hash lookups filter on (api_key_id, message_hash) first --
-- this index makes that the only index scan needed before the tiny
-- created_at/expires_at filtering.
CREATE INDEX IF NOT EXISTS api_response_cache_key_hash_idx
  ON public.api_response_cache (api_key_id, message_hash, created_at DESC);

GRANT SELECT ON public.api_response_cache TO authenticated;
GRANT ALL ON public.api_response_cache TO service_role;

ALTER TABLE public.api_response_cache ENABLE ROW LEVEL SECURITY;

-- Same convention as api_response_generations: read-only for the
-- account that owns the key, every write goes through control-api's own
-- service-role client.
CREATE POLICY "Owners and team members read their api response cache"
  ON public.api_response_cache FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_account_member(user_id));

-- Mirrors search_response_context's exact shape (see
-- 20260905010000_response_context_embeddings.sql) -- same pgvector
-- extension, same 768-dimension embedding model, same service-role-only
-- RPC pattern. A near-verbatim rephrasing needs a FAR stricter floor
-- than "similar enough to be useful context" (MIN_CONTEXT_SIMILARITY =
-- 0.55) -- see response-cache.ts's own MIN_CACHE_SIMILARITY for the
-- actual threshold applied to this RPC's result.
CREATE OR REPLACE FUNCTION public.search_response_cache(
  _api_key_id uuid,
  _embedding vector(768),
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
