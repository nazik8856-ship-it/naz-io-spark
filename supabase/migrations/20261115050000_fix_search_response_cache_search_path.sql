-- The open platform incident "vector_rpc_search_path:search_response_cache" (since 2026-10-05) is still true for one copy of the function:
-- the 4-argument search_response_cache(uuid, vector, integer, integer) has search_path = public, pg_temp, with no schema for pgvector, so
-- its <=> operator is not found and a call would fail. Nothing calls it any more (the response cache asks search_response_cache_v2, which
-- is correct), but the health check looks at every copy, so the incident stays open. Same fix the incident itself names.
DO $$
BEGIN
  IF to_regprocedure('public.search_response_cache(uuid, extensions.vector, integer, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.search_response_cache(uuid, extensions.vector, integer, integer) SET search_path = public, extensions, pg_temp;
  END IF;
END $$;
