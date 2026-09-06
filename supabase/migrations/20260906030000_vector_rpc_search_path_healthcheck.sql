-- Closes the exact blind spot that hid the vector-search search_path bug
-- (see 20260906020000_fix_vector_search_path_extensions_schema.sql) for an
-- unknown period: none of the existing health checks would have caught it.
-- precedent-pipeline-health-sweep only measures whether decisions are
-- getting EMBEDDED (write-side), never whether the search RPC can actually
-- read them back -- and even a dedicated "call the RPC and see if it
-- errors" check would have missed it here, since Postgres never evaluates
-- an ORDER BY/SELECT expression (the `<=>` operator) against zero matching
-- rows, so a fresh account with no data yet still looks "healthy" even
-- when genuinely broken. A metadata check instead -- does each function's
-- OWN search_path actually include the schema pgvector lives in -- is
-- deterministic, has zero side effects, and would have caught this on day
-- one regardless of how much real data existed.
--
-- Wired into cron-health-check (see its own edge function), which already
-- runs every 30 minutes unconditionally -- the correct home, since this is
-- a platform-wide infrastructure property (a function's search_path is set
-- once for the whole database), not a per-customer-account signal the way
-- precedent-pipeline-health-sweep's own checks are.
CREATE OR REPLACE FUNCTION public.check_vector_rpc_search_paths()
RETURNS TABLE(function_name text, search_path_ok boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.proname::text,
    EXISTS (
      SELECT 1 FROM unnest(p.proconfig) cfg
      WHERE cfg LIKE 'search_path=%' AND cfg LIKE '%extensions%'
    )
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    -- Every known function that compares two pgvector values via `<=>` --
    -- add a new one here the day it's created, not after it's discovered
    -- broken.
    AND p.proname IN ('search_decision_precedent', 'search_response_context', 'search_response_cache')
  ORDER BY p.proname;
$$;

REVOKE ALL ON FUNCTION public.check_vector_rpc_search_paths() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_vector_rpc_search_paths() TO service_role;
