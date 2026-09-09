-- "Own decision-making machine" plan, integration round: a content gap
-- cluster (items 179-180) never gets removed once every one of its
-- member gaps is resolved or aged out by retention-sweep -- it just sits
-- in content_gap_clusters forever, invisible to list_gap_clusters_ranked
-- (its own JOIN already requires an unresolved member) but never
-- actually cleaned up. Low volume today, but genuinely unbounded, and
-- exactly the "will accumulate forever" shape retention-sweep already
-- exists to close for six other tables.
--
-- Expressed as a service-role RPC, not a plain PostgREST delete, because
-- "every cluster with NO remaining unresolved member" is a NOT EXISTS
-- correlated subquery the fluent client can't express -- same reason
-- list_resolvable_gap_candidates (20260907020000) is an RPC instead of a
-- .from() chain. Also incidentally cleans up the one theoretical orphan
-- case where content-gap-triage-sweep's own clustering phase creates a
-- cluster row but then fails to attach its first member (a partial
-- failure between the two writes) -- such a cluster has zero members
-- ever, which trivially satisfies "no remaining unresolved member" too.
CREATE FUNCTION public.delete_orphaned_gap_clusters()
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  DELETE FROM public.content_gap_clusters c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.api_response_generations g
    WHERE g.content_gap_cluster_id = c.id AND g.resolved_at IS NULL
  )
  RETURNING c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_orphaned_gap_clusters() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_orphaned_gap_clusters() TO service_role;
