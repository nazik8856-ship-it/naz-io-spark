-- User & data isolation, front 4: live updates (Supabase Realtime) join the database report.
--
-- Realtime pushes row changes to subscribers and applies the table's own read rules to each one, so a published table is only as safe as
-- those rules. Two new findings in isolation_report():
--   realtime_exposed          a table in the supabase_realtime publication whose access type is not owner, team, self or membership
--                             (a platform-wide, link-open, shared or server-only table must never be pushed live)
--   realtime_broadcast_open   a rule on realtime.messages (broadcast / presence channels) that lets everyone in; none exist today and
--                             the app uses table changes only, so any such rule is a mistake
-- Today: agent_decisions, agent_events, agent_runs and outer_control_evaluations are published; all are owner/team tables.

CREATE OR REPLACE FUNCTION public.isolation_report()
RETURNS TABLE(kind text, object text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH tbl AS (
    SELECT c.oid, c.relname::text AS name, c.relrowsecurity AS rls, i.access, i.owner_column, i.read_all_reason
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN public.isolation_tables i ON i.table_name = c.relname
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ),
  pol AS (
    SELECT t.name, t.access, t.read_all_reason, p.polname::text AS polname, p.polcmd::text AS cmd,
      coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS q, coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS w
    FROM tbl t JOIN pg_policy p ON p.polrelid = t.oid
    -- policies that apply to visitors or signed-in users: PUBLIC (0), anon or authenticated
    WHERE p.polroles && ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid]
  )
  SELECT 'unregistered_table', name, 'add it to isolation_tables with its access type' FROM tbl WHERE access IS NULL
  UNION ALL
  SELECT 'unregistered_table', i.table_name, 'registered but no longer exists' FROM public.isolation_tables i
    WHERE to_regclass(format('public.%I', i.table_name)) IS NULL
  UNION ALL
  SELECT 'rls_off', name, 'row level security is off' FROM tbl WHERE NOT rls
  UNION ALL
  SELECT 'read_all', name || ' / ' || polname, 'every row readable (' || cmd || ': ' || q || ')'
    FROM pol WHERE (q = 'true' OR (cmd IN ('a', '*') AND w = 'true')) AND read_all_reason IS NULL
  UNION ALL
  SELECT 'no_identity_check', name || ' / ' || polname, left(cmd || ': ' || coalesce(nullif(q, ''), w), 200)
    FROM pol WHERE q <> 'true' AND w <> 'true' AND read_all_reason IS NULL  -- a recorded reason covers a deliberately open table
      AND (q || ' ' || w) !~ '(auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|is_account_member\(|has_role\(|can_access\()'
  UNION ALL
  SELECT 'system_table_exposed', name || ' / ' || polname, left(cmd || ': ' || coalesce(nullif(q, ''), w), 200)
    FROM pol WHERE access = 'system_only' AND (q || ' ' || w) !~ 'auth\.role\(\) = ''service_role'''
  UNION ALL
  SELECT 'owner_nullable', t.name || '.' || t.owner_column, 'the owner column can be empty'
    FROM tbl t JOIN information_schema.columns k ON k.table_schema = 'public' AND k.table_name = t.name AND k.column_name = t.owner_column
    WHERE t.access IN ('owner', 'team', 'public_by_link') AND k.is_nullable = 'YES'
  UNION ALL
  SELECT 'owner_unguarded', t.name || '.' || t.owner_column, 'a signed-in user could change the owner of a row (no prevent_owner_change trigger)'
    FROM tbl t
    WHERE to_regprocedure('public.prevent_owner_change()') IS NOT NULL
      AND t.owner_column IS NOT NULL AND t.access IN ('owner', 'team', 'public_by_link', 'self', 'membership')
      AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = t.name AND k.column_name = t.owner_column)
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_proc f ON f.oid = g.tgfoid
                      WHERE g.tgrelid = t.oid AND NOT g.tgisinternal AND f.proname = 'prevent_owner_change' AND f.pronamespace = 'public'::regnamespace)
  UNION ALL
  SELECT 'realtime_exposed', t.name, 'rows of this table are pushed live to subscribers, but its access type is ' || coalesce(t.access, 'unregistered') || ' (live updates are for owner, team, self or membership tables only)'
    FROM tbl t JOIN pg_publication_rel r ON r.prrelid = t.oid JOIN pg_publication pub ON pub.oid = r.prpubid AND pub.pubname = 'supabase_realtime'
    WHERE t.access IS DISTINCT FROM 'owner' AND t.access IS DISTINCT FROM 'team' AND t.access IS DISTINCT FROM 'self' AND t.access IS DISTINCT FROM 'membership'
  UNION ALL
  SELECT 'realtime_broadcast_open', 'realtime.messages / ' || p.polname::text, 'a broadcast or presence channel rule lets everyone in (' || coalesce(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), 'no condition') || ')'
    FROM pg_policy p
    WHERE p.polrelid = to_regclass('realtime.messages')
      AND (coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') = 'true' AND coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true')
  UNION ALL
  SELECT 'unchecked_function', p.oid::regprocedure::text,
    'SECURITY DEFINER, callable by ' || concat_ws(' and ',
      CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'visitors' END,
      CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'signed-in users' END)
      || ', never checks the caller'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      AND p.prosrc !~ '(auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|is_account_member\()'
      AND p.proname NOT IN (SELECT function_name FROM public.isolation_public_functions)
  ORDER BY 1, 2;
$$;
REVOKE ALL ON FUNCTION public.isolation_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.isolation_report() TO service_role;
