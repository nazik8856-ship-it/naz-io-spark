-- "Real precedent memory" plan, item 7: sometimes a past decision was
-- simply a mistake -- later reversed, or based on bad information -- and
-- without a way to say so, it keeps quietly influencing future automatic
-- decisions forever just because it superficially resembles new
-- requests. Give an account a real, permanent way to exclude one
-- specific past decision from ever being used as precedent again.
--
-- A plain boolean flag on the existing decision_embeddings row (one row
-- per decision, decision_id UNIQUE), not a separate exclusions table --
-- there's nothing else to store about an exclusion (no reason field was
-- asked for, per this round's own scope decisions), and this is the
-- exact row search_decision_precedent already reads.
ALTER TABLE public.decision_embeddings
  ADD COLUMN excluded_from_precedent boolean NOT NULL DEFAULT false;

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
    AND de.excluded_from_precedent = false
    AND (_exclude_decision_id IS NULL OR de.decision_id <> _exclude_decision_id)
  ORDER BY de.embedding <=> _embedding
  LIMIT GREATEST(1, LEAST(_limit, 50));
END;
$$;

REVOKE ALL ON FUNCTION public.search_decision_precedent(uuid, vector, uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_decision_precedent(uuid, vector, uuid, int) TO service_role;
