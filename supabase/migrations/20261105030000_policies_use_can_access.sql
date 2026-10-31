-- User & data isolation, leftovers of fronts 2 and 3: the team rules say "the owner, or a team member" in ONE way.
--
-- Until now each table spelled that out itself (is_account_member(user_id), sometimes with "OR auth.uid() = user_id" in front, sometimes
-- with a role and a permission). They all mean the same thing, so they now all call can_access(): the owner of the row, or an active
-- member of the owner's team at the role (and, for changes, the permission) the rule asks for. One definition to read and to fix.
--
-- 1. can_access(owner, min_role, permission): the helper gets the optional permission category the change rules carry.
-- 2. Every policy that called is_account_member(...) directly is rewritten in place (ALTER POLICY: name, command and roles stay).
--    Nothing changes for anyone, with one deliberate difference in wording only: can_access also says yes to the owner of the row.
--    A rule is therefore only rewritten when the owner already has the same access through another rule on that table (checked here,
--    per command); otherwise it is left as it is and reported in the notices below. Today that is one rule:
--    knowledge_base_entries "Team owners can manage ...", which gives the owner no direct write access on purpose.
-- 3. The migration stops if any rule other than that one still calls is_account_member() afterwards.

-- 1. ------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access(_owner uuid, _min_role text, _permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _owner IS NOT NULL AND auth.uid() IS NOT NULL
    AND (auth.uid() = _owner OR public.is_account_member(_owner, _min_role, _permission))
$$;
REVOKE ALL ON FUNCTION public.can_access(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access(uuid, text, text) TO authenticated, service_role;

-- 2. ------------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  nq text;
  nw text;
  covered boolean;
  stmt text;
  rewrite_count integer := 0;
  rx_owner_or_member constant text := '\(\(auth\.uid\(\) = (\w+)\) OR is_account_member\(\1\)\)';
BEGIN
  FOR r IN
    SELECT c.oid AS reloid, c.oid::regclass AS tbl, p.oid AS poid, p.polname, p.polcmd,
           coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS q,
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS w
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'is_account_member\('
    ORDER BY c.relname, p.polname
  LOOP
    -- "owner OR team" is already complete in the rule itself; every other form needs the owner covered by a sibling rule.
    IF (r.q || ' ' || r.w) ~ rx_owner_or_member THEN
      covered := true;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM pg_policy o
        WHERE o.polrelid = r.reloid AND o.oid <> r.poid AND (o.polcmd = r.polcmd OR o.polcmd = '*')
          AND (coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ' ' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), ''))
              ~ '(auth\.uid\(\) = (user_id|id)([^_a-z]|$))|((user_id|id) = auth\.uid\(\))'
      ) INTO covered;
    END IF;
    IF NOT covered THEN
      RAISE NOTICE 'left as it is (the owner has no direct access to this): % on %', r.polname, r.tbl;
      CONTINUE;
    END IF;

    nq := regexp_replace(r.q, rx_owner_or_member, 'public.can_access(\1)', 'g');
    nq := regexp_replace(nq, 'is_account_member\((\w+), ''owner''::text, ''(\w+)''::text\)', 'public.can_access(\1, ''owner''::text, ''\2''::text)', 'g');
    nq := regexp_replace(nq, 'is_account_member\((\w+), ''owner''::text\)', 'public.can_access(\1, ''owner''::text)', 'g');
    nq := regexp_replace(nq, 'is_account_member\((\w+)\)', 'public.can_access(\1)', 'g');
    nw := regexp_replace(r.w, rx_owner_or_member, 'public.can_access(\1)', 'g');
    nw := regexp_replace(nw, 'is_account_member\((\w+), ''owner''::text, ''(\w+)''::text\)', 'public.can_access(\1, ''owner''::text, ''\2''::text)', 'g');
    nw := regexp_replace(nw, 'is_account_member\((\w+), ''owner''::text\)', 'public.can_access(\1, ''owner''::text)', 'g');
    nw := regexp_replace(nw, 'is_account_member\((\w+)\)', 'public.can_access(\1)', 'g');

    stmt := format('ALTER POLICY %I ON %s', r.polname, r.tbl)
         || CASE WHEN r.q <> '' THEN format(' USING (%s)', nq) ELSE '' END
         || CASE WHEN r.w <> '' THEN format(' WITH CHECK (%s)', nw) ELSE '' END;
    EXECUTE stmt;
    rewrite_count := rewrite_count + 1;
  END LOOP;
  RAISE NOTICE 'rules moved to can_access: %', rewrite_count;
END $$;

-- 3. ------------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE leftover text;
BEGIN
  SELECT string_agg(c.relname || ' / ' || p.polname, '; ') INTO leftover
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'is_account_member\('
    AND NOT (c.relname = 'knowledge_base_entries' AND p.polcmd = '*');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'rules still call is_account_member() directly: %', leftover;
  END IF;
END $$;
