-- "/respond" MVP backlog, item 163: retrieval-based context for
-- api_key_context_entries. Today POST /control-api/v1/respond loads every
-- enabled entry for the key (capped at 20 by buildContextPromptBlock,
-- oldest-created-first) regardless of whether it has anything to do with
-- the incoming message -- fine while a key has a handful of entries, but
-- once a key's context grows into a real knowledge base, the entries that
-- actually answer THIS question can silently fall past the cap in favor
-- of older, unrelated ones. Mirrors search_decision_precedent's own exact
-- shape (20260828140000_search_decision_precedent.sql) -- same pgvector
-- extension (already enabled), same 768-dimension embedding model
-- (_shared/decision-embeddings.ts), same service-role-only RPC pattern.
--
-- embedding is nullable, not backfilled here: this table is brand new
-- (shipped this same week) and a null embedding is a normal, expected
-- state for an entry created before this migration, or one whose
-- embedding call failed -- _shared/response-context.ts's retrieval falls
-- back to the original "every enabled entry" behavior whenever a key has
-- no embedded entries at all, so nothing regresses for those rows.
ALTER TABLE public.api_key_context_entries
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- No ANN index (ivfflat/hnsw) yet -- same reasoning as
-- decision_embeddings: exact nearest-neighbor search, filtered to one
-- api_key_id first via the existing api_key_context_entries_key_idx, is
-- both correct and fast enough at the volumes a genuinely new feature
-- starts at. Add one once a real account's own entry count justifies it.

CREATE OR REPLACE FUNCTION public.search_response_context(
  _api_key_id uuid,
  _embedding vector(768),
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
