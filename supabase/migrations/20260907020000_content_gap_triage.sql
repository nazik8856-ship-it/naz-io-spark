-- "Own decision-making machine" plan, items 179-180 (Phase 3): closing
-- the loop on content gaps (item 169) two ways --
--
-- 1. Auto-resolution: once an account owner adds a context entry that
--    now covers a previously-unanswered question, that gap should stop
--    showing up as something still to fix. resolved_at/resolved_by_entry_id
--    let content-gap-triage-sweep mark a gap resolved once retrieval
--    would now find a qualifying match for it -- content-gaps.ts's own
--    read query is updated to exclude resolved rows.
-- 2. Clustering: dozens of differently-worded gap rows are often really
--    the SAME underlying missing fact ("refund times?", "how long for a
--    refund", "when will I get refunded"). content_gap_clusters groups
--    them so the account owner sees one ranked to-do item ("asked 47
--    times") instead of 47 raw rows.
--
-- Both computed by the same sweep (content-gap-triage-sweep) since both
-- need the same free local embedding of the gap's message -- no reason
-- to pay for it twice in two separate cron jobs.
ALTER TABLE public.api_response_generations
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by_entry_id uuid REFERENCES public.api_key_context_entries(id) ON DELETE SET NULL;

CREATE TABLE public.content_gap_clusters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  -- The first gap message assigned to this cluster -- used as the
  -- human-facing label for the whole group. Never edited after
  -- creation; if it stops being representative, that's a signal to add
  -- a context entry, not something this table tries to keep "fresh."
  -- Same 500-char bound as api_response_generations.message, which this
  -- is always copied directly from (already truncated at write time).
  representative_message text not null check (char_length(representative_message) > 0 and char_length(representative_message) <= 500),
  embedding vector(384),
  created_at timestamptz not null default now()
);

ALTER TABLE public.api_response_generations
  ADD COLUMN content_gap_cluster_id uuid REFERENCES public.content_gap_clusters(id) ON DELETE SET NULL;

CREATE INDEX idx_content_gap_clusters_key ON public.content_gap_clusters (api_key_id, created_at);
-- Both of content-gap-triage-sweep's own candidate queries filter on
-- this exact shape (grounding_check_intervened = true, is_test = false,
-- plus either resolved_at IS NULL or content_gap_cluster_id IS NULL) --
-- one partial index serves both.
CREATE INDEX idx_api_response_generations_gap_triage
  ON public.api_response_generations (api_key_id, created_at)
  WHERE grounding_check_intervened = true AND is_test = false;

ALTER TABLE public.content_gap_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners and team members read their content gap clusters" ON public.content_gap_clusters
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR is_account_member(user_id));

-- Nearest-cluster lookup for the sweep's own clustering pass. Same
-- SECURITY DEFINER + search_path shape as search_response_context/
-- search_response_cache/search_decision_precedent -- `extensions`
-- included from the start this time (see
-- 20260906020000_fix_vector_search_path_extensions_schema.sql for why
-- omitting it silently breaks every call).
CREATE FUNCTION public.search_gap_clusters(
  _api_key_id uuid,
  _embedding vector(384),
  _limit int DEFAULT 1
)
RETURNS TABLE(id uuid, representative_message text, similarity float)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT
    c.id,
    c.representative_message,
    (1 - (c.embedding <=> _embedding))::float AS similarity
  FROM public.content_gap_clusters c
  WHERE c.api_key_id = _api_key_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> _embedding
  LIMIT GREATEST(1, LEAST(_limit, 20));
END;
$$;

REVOKE ALL ON FUNCTION public.search_gap_clusters(uuid, vector, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_gap_clusters(uuid, vector, int) TO service_role;

-- The resolution pass's own candidate query: a correlated EXISTS
-- PostgREST's fluent client can't express. Only returns a gap when this
-- key has gained a genuinely NEW embedded context entry since the gap
-- itself was recorded -- an unresolved gap with nothing new to check it
-- against is skipped entirely, cheaply, rather than re-embedding and
-- re-searching the exact same still-unanswered question every single
-- sweep tick forever.
CREATE FUNCTION public.list_resolvable_gap_candidates(_limit int DEFAULT 200)
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
    AND EXISTS (
      SELECT 1 FROM public.api_key_context_entries e
      WHERE e.api_key_id = g.api_key_id AND e.created_at > g.created_at AND e.embedding IS NOT NULL
    )
  ORDER BY g.created_at ASC
  LIMIT GREATEST(1, LEAST(_limit, 500));
$$;

REVOKE ALL ON FUNCTION public.list_resolvable_gap_candidates(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_resolvable_gap_candidates(int) TO service_role;

-- The ranked to-do list itself: every cluster with at least one still-
-- UNRESOLVED member, ordered by how many times it's actually come up.
-- Deliberately computed live via COUNT/MIN/MAX rather than maintaining
-- a mutable counter on content_gap_clusters -- a counter would need
-- updating (or drift) every time content-gap-triage-sweep's OTHER pass
-- resolves a member gap; a live join can't drift, and this table is
-- small enough per key that the join is cheap.
CREATE FUNCTION public.list_gap_clusters_ranked(
  _api_key_id uuid,
  _limit int DEFAULT 20
)
RETURNS TABLE(
  cluster_id uuid,
  representative_message text,
  occurrence_count bigint,
  first_seen_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.representative_message, count(g.id), min(g.created_at), max(g.created_at)
  FROM public.content_gap_clusters c
  JOIN public.api_response_generations g
    ON g.content_gap_cluster_id = c.id AND g.resolved_at IS NULL AND g.is_test = false
  WHERE c.api_key_id = _api_key_id
  GROUP BY c.id, c.representative_message
  ORDER BY count(g.id) DESC, max(g.created_at) DESC
  LIMIT GREATEST(1, LEAST(_limit, 100));
$$;

REVOKE ALL ON FUNCTION public.list_gap_clusters_ranked(uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_gap_clusters_ranked(uuid, int) TO service_role;

-- ============================================================
-- POST-MIGRATION STEP (same convention as every other scheduled sweep in
-- this codebase -- applied directly against the live project, not baked
-- into this file, since it needs this project's own service_role vault
-- secret and function URL):
--
--    SELECT cron.schedule(
--      'content-gap-triage-sweep-every-30min',
--      '*/30 * * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/content-gap-triage-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
