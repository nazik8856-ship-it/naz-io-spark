-- User & data isolation, front 2, part 1 of 2 (additive: nothing that works today stops working).
--
-- A published site is opened by anyone who has its link, but until now that was done by letting every visitor read every row of
-- websites, website_pages and shared_websites, with the owner's prompt, notes, trust score and user id. This part adds what
-- replaces that: get_public_site(), which returns ONE site, looked up by its id, subdomain or custom domain, with only what the
-- public preview shows. Part 2 (20261105020000) removes the read-everything rules once the website uses the lookup.
--
-- 1. can_access(owner, min_role): the one helper for "the owner, or an active member of the owner's team at this role".
-- 2. isolation_public_functions: database functions that are open to visitors on purpose, each with its reason; the report
--    skips them.
-- 3. get_public_site(_ref, _meta_only): the lookup.
-- 4. Team members can read their account's websites on their own rights. They only could before because everyone could.
-- 5. isolation_report() knows about registered public functions (and, once part 2 exists, an unguarded owner column).

-- 1. ------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access(_owner uuid, _min_role text DEFAULT 'viewer')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _owner IS NOT NULL AND auth.uid() IS NOT NULL
    AND (auth.uid() = _owner OR public.is_account_member(_owner, _min_role, NULL))
$$;
REVOKE ALL ON FUNCTION public.can_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access(uuid, text) TO authenticated, service_role;

-- 2. ------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.isolation_public_functions (
  function_name text PRIMARY KEY,
  reason text NOT NULL CHECK (length(reason) >= 20)
);
ALTER TABLE public.isolation_public_functions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.isolation_public_functions FROM anon, authenticated;
INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
VALUES ('isolation_public_functions', 'system_only', NULL, NULL, 'database functions open to visitors on purpose, with the reason')
ON CONFLICT (table_name) DO NOTHING;

-- 3. ------------------------------------------------------------------------------------------------------------------------
-- A site is found by its id (random, unguessable), or by the subdomain or custom domain its owner gave it. Only what the public
-- preview renders comes back: never prompt, generation_notes, trust_score, user_id or anything else about the owner.
-- With _meta_only the pages are left out (used for the title and description of a shared link).
CREATE OR REPLACE FUNCTION public.get_public_site(_ref text, _meta_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', w.id, 'name', w.name, 'tagline', w.tagline, 'theme', w.theme, 'images_status', w.images_status)
    || CASE WHEN _meta_only THEN '{}'::jsonb ELSE jsonb_build_object('pages', coalesce((
         SELECT jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'seo_description', p.seo_description,
                                             'sections', p.sections, 'order_index', p.order_index) ORDER BY p.order_index)
         FROM public.website_pages p WHERE p.website_id = w.id), '[]'::jsonb)) END
  FROM public.websites w
  WHERE length(coalesce(_ref, '')) BETWEEN 1 AND 253
    AND (w.id = CASE WHEN _ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN _ref::uuid END
         OR lower(w.subdomain) = lower(_ref) OR lower(w.custom_domain) = lower(_ref))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_public_site(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_site(text, boolean) TO anon, authenticated, service_role;
INSERT INTO public.isolation_public_functions (function_name, reason) VALUES
  ('get_public_site', 'opens ONE published site by its link (id, subdomain or custom domain) for anyone; returns only what the public preview shows, never the owner, prompt or notes')
ON CONFLICT (function_name) DO UPDATE SET reason = EXCLUDED.reason;

-- 4. ------------------------------------------------------------------------------------------------------------------------
-- Owners already read their own rows. A team member (viewer or above) reads the account's sites too; writes stay with the owner.
DROP POLICY IF EXISTS "Team members can view their account websites" ON public.websites;
CREATE POLICY "Team members can view their account websites" ON public.websites FOR SELECT TO authenticated
  USING (public.can_access(user_id, 'viewer'));
DROP POLICY IF EXISTS "Team members can view their account website pages" ON public.website_pages;
CREATE POLICY "Team members can view their account website pages" ON public.website_pages FOR SELECT TO authenticated
  USING (public.can_access(user_id, 'viewer'));
-- shared_websites had only the read-everything rule; its owner reads their own.
DROP POLICY IF EXISTS "Owners can view their shared websites" ON public.shared_websites;
CREATE POLICY "Owners can view their shared websites" ON public.shared_websites FOR SELECT TO authenticated
  USING (public.can_access(user_id, 'viewer'));

-- 5. ------------------------------------------------------------------------------------------------------------------------
-- One row per gap (see 20261104020000), plus:
--   owner_unguarded      a table's owner column can be changed by a signed-in user (no prevent_owner_change trigger; part 2)
-- and a SECURITY DEFINER function listed in isolation_public_functions is not reported as unchecked.
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
