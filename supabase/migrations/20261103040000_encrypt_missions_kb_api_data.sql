-- Data encryption, fronts 3 and 4: what a Generator request asked for (missions.directive), the account's knowledge-base text
-- (knowledge_base_entries.entry_text), and the /respond API's context entries, cached answers and logged questions
-- (api_key_context_entries.entry_text, api_response_cache.message/answer, api_response_generations.message) are stored encrypted
-- by the edge functions (DATA_KEY, _shared/encrypted-db.ts), the same way as Outer Control content (20261103010000).
--
-- Three database functions returned that text. Their _v2 versions also return the row id and the encrypted value, which the
-- server decrypts (search_response_cache_v2, search_response_context_v2, list_resolvable_gap_candidates_v2); the code calls
-- only those. The similarity search itself is unchanged: embeddings stay as they are.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('missions', 'directive'), ('knowledge_base_entries', 'entry_text'), ('api_key_context_entries', 'entry_text'),
    ('api_response_cache', 'message'), ('api_response_cache', 'answer'), ('api_response_generations', 'message')
  ) AS v(t, c) LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text', r.t, r.c || '_enc');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    INSERT INTO public.encrypted_columns (table_name, column_name, note)
    VALUES (r.t, r.c, 'Encrypted with DATA_KEY (encrypted-db.ts).')
    ON CONFLICT (table_name, column_name) DO NOTHING;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS missions_plain_wins ON public.missions;
CREATE TRIGGER missions_plain_wins BEFORE INSERT OR UPDATE ON public.missions FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('directive');
DROP TRIGGER IF EXISTS knowledge_base_entries_plain_wins ON public.knowledge_base_entries;
CREATE TRIGGER knowledge_base_entries_plain_wins BEFORE INSERT OR UPDATE ON public.knowledge_base_entries FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('entry_text');
DROP TRIGGER IF EXISTS api_key_context_entries_plain_wins ON public.api_key_context_entries;
CREATE TRIGGER api_key_context_entries_plain_wins BEFORE INSERT OR UPDATE ON public.api_key_context_entries FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('entry_text');
DROP TRIGGER IF EXISTS api_response_cache_plain_wins ON public.api_response_cache;
CREATE TRIGGER api_response_cache_plain_wins BEFORE INSERT OR UPDATE ON public.api_response_cache FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('message', 'answer');
DROP TRIGGER IF EXISTS api_response_generations_plain_wins ON public.api_response_generations;
CREATE TRIGGER api_response_generations_plain_wins BEFORE INSERT OR UPDATE ON public.api_response_generations FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('message');

CREATE OR REPLACE FUNCTION public.list_resolvable_gap_candidates_v2(_limit integer DEFAULT 200)
RETURNS TABLE(id uuid, api_key_id uuid, message text, message_enc text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT g.id, g.api_key_id, g.message, g.message_enc
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
REVOKE ALL ON FUNCTION public.list_resolvable_gap_candidates_v2(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_resolvable_gap_candidates_v2(integer) TO service_role;

-- The two similarity searches need pgvector (present on the live project; skipped where it is not installed).
DO $do$
BEGIN
  IF to_regtype('extensions.vector') IS NULL THEN RETURN; END IF;
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.search_response_cache_v2(_api_key_id uuid, _embedding extensions.vector, _policy_version integer, _limit integer DEFAULT 3)
    RETURNS TABLE(id uuid, answer text, answer_enc text, sources jsonb, confidence text, similarity double precision)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $b$
    BEGIN
      IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not authorized'; END IF;
      RETURN QUERY
      SELECT c.id, c.answer, c.answer_enc, c.sources, c.confidence, (1 - (c.embedding <=> _embedding))::float AS similarity
      FROM public.api_response_cache c
      WHERE c.api_key_id = _api_key_id AND c.embedding IS NOT NULL AND c.expires_at > now() AND c.policy_version = _policy_version
      ORDER BY c.embedding <=> _embedding
      LIMIT GREATEST(1, LEAST(_limit, 20));
    END $b$
  $f$;
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.search_response_context_v2(_api_key_id uuid, _embedding extensions.vector, _limit integer DEFAULT 8)
    RETURNS TABLE(id uuid, entry_text text, entry_text_enc text, similarity double precision)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $b$
    BEGIN
      IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not authorized'; END IF;
      RETURN QUERY
      SELECT e.id, e.entry_text, e.entry_text_enc, (1 - (e.embedding <=> _embedding))::float AS similarity
      FROM public.api_key_context_entries e
      WHERE e.api_key_id = _api_key_id AND e.enabled = true AND e.embedding IS NOT NULL
      ORDER BY e.embedding <=> _embedding
      LIMIT GREATEST(1, LEAST(_limit, 50));
    END $b$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.search_response_cache_v2(uuid, extensions.vector, integer, integer) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.search_response_cache_v2(uuid, extensions.vector, integer, integer) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.search_response_context_v2(uuid, extensions.vector, integer) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.search_response_context_v2(uuid, extensions.vector, integer) TO service_role';
END $do$;

-- cron-health-check watches every function that compares pgvector values for a search_path without `extensions`; add the two
-- _v2 searches the code now calls.
DO $$
DECLARE def text;
BEGIN
  IF to_regprocedure('public.check_vector_rpc_search_paths()') IS NULL THEN RETURN; END IF;
  def := pg_get_functiondef('public.check_vector_rpc_search_paths()'::regprocedure);
  IF position('''search_response_cache_v2''' IN def) = 0 THEN
    EXECUTE replace(def, '''search_response_cache'')', '''search_response_cache'', ''search_response_context_v2'', ''search_response_cache_v2'')');
  END IF;
END $$;
