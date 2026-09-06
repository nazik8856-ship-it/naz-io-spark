-- Real bug fix, discovered while live-testing item 176/167: every pgvector
-- search RPC in this codebase (search_response_context, search_response_cache,
-- and the older search_decision_precedent that powers the entire precedent
-- system, items 101-130) was created with `SET search_path = public, pg_temp`
-- -- but this project's `vector` extension lives in the `extensions` schema
-- (Supabase's own default: `create extension vector schema extensions;`),
-- not `public`. Postgres resolves an unqualified operator like `<=>` by
-- searching schemas in search_path, in order -- with `extensions` missing
-- from it, every single call to any of these three SECURITY DEFINER
-- functions has been failing at the `<=>` comparison with
-- "operator does not exist: extensions.vector <=> extensions.vector",
-- caught by each caller's own "no result is a normal, expected outcome"
-- try/catch and silently reported as "no precedent/context found" --
-- indistinguishable from a genuine empty result, so nothing surfaced this
-- until a live end-to-end call actually inspected the RPC's own error.
--
-- This means the precedent system (fast-mode auto-resolve precedent checks,
-- full-mode LLM prompt precedent blocks, precedent-informed auto_narrow,
-- precedent citations, contradictory-precedent detection -- all of items
-- 103-109) has never actually found a real precedent match in production;
-- every one of those features has been running on an empty result set since
-- the day search_decision_precedent was created. Fixing the search_path is
-- the entire fix -- no application code, no data backfill, nothing else was
-- wrong.
ALTER FUNCTION public.search_decision_precedent(uuid, vector, uuid, int)
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.search_response_context(uuid, vector, int)
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.search_response_cache(uuid, vector, int)
  SET search_path = public, extensions, pg_temp;
