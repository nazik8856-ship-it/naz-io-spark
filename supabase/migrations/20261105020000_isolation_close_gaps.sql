-- User & data isolation, front 2, part 2 of 2: close the gaps. Apply only after the website reads sites through get_public_site()
-- (20261105010000 and the website change that uses it), or the public preview would stop loading.
--
-- 1. The read-everything rules on websites, website_pages and shared_websites go. Owners and their team keep their own access
--    (part 1); a visitor opens one site through get_public_site() and can no longer list the others.
-- 2. Seven database functions that only the server calls (rate-limit counters, retention sweep, policy snapshots) lose browser
--    access. Until now anyone could call them: bump another account's or IP's rate-limit counter until it was locked out, or
--    delete another account's old events by passing its id.
-- 3. has_role() answers only about the caller for signed-in users and visitors; the server and database jobs may ask about anyone.
-- 4. The owner of a row can not be changed by a signed-in user (prevent_owner_change on every table with a registered owner
--    column). Team-owner rules only check membership of the account the row ends up in, so a team owner of two accounts could
--    have moved a rule, webhook or spend cap from one to the other.
-- 5. cross_account_precedent_stats: the database itself shows a row only once enough accounts contributed (it was only the
--    server that held back the rest; the browser read the table directly).

-- 1. ------------------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view a website by its link" ON public.websites;
DROP POLICY IF EXISTS "Anyone can view pages of a website by its link" ON public.website_pages;
DROP POLICY IF EXISTS "Anyone can view shared websites" ON public.shared_websites;

-- 2. ------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.build_policy_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_expired_agent_events(uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_policy_version(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_clean_allow_count(uuid, uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_ip_rate_limit(text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_rate_limit(uuid, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_stale_generation_progress() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_policy_snapshot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_expired_agent_events(uuid, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_policy_version(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_clean_allow_count(uuid, uuid, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_ip_rate_limit(text, text, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_stale_generation_progress() TO service_role;

-- 3. ------------------------------------------------------------------------------------------------------------------------
-- Rules and functions ask has_role(auth.uid(), ...), which is always the caller. A visitor or signed-in user asking about
-- someone else gets false; the server key and database jobs (scheduled jobs, migrations) have no sign-in and may ask about anyone.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
    AND (coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') OR (auth.uid() IS NOT NULL AND auth.uid() = _user_id))
$$;

-- 4. ------------------------------------------------------------------------------------------------------------------------
-- Signed-in users and visitors (the roles the API uses for them) can not change a row's owner; the server key and database jobs can.
CREATE OR REPLACE FUNCTION public.prevent_owner_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE col text := TG_ARGV[0];
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
    RAISE EXCEPTION 'the owner of this row can not be changed' USING ERRCODE = '42501', DETAIL = format('%s.%s', TG_TABLE_NAME, col);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.prevent_owner_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl, i.owner_column
    FROM public.isolation_tables i JOIN pg_class c ON c.oid = to_regclass(format('public.%I', i.table_name))
    WHERE i.owner_column IS NOT NULL AND c.relkind IN ('r', 'p')
      AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = i.table_name AND k.column_name = i.owner_column)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS prevent_owner_change ON %s', r.tbl);
    EXECUTE format('CREATE TRIGGER prevent_owner_change BEFORE UPDATE OF %I ON %s FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_change(%L)',
      r.owner_column, r.tbl, r.owner_column);
  END LOOP;
END $$;

-- 5. ------------------------------------------------------------------------------------------------------------------------
-- 2 = MIN_CONTRIBUTING_ACCOUNTS in supabase/functions/_shared/cross-account-precedent.ts (src/test/data-isolation.test.ts keeps them equal).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT polname FROM pg_policy WHERE polrelid = 'public.cross_account_precedent_stats'::regclass AND polcmd = 'r' LOOP
    EXECUTE format('DROP POLICY %I ON public.cross_account_precedent_stats', r.polname);
  END LOOP;
END $$;
CREATE POLICY "Read precedent once at least 2 accounts contributed" ON public.cross_account_precedent_stats
  FOR SELECT TO authenticated USING (contributing_account_count >= 2);
UPDATE public.isolation_tables SET read_all_reason = 'combined counts per action type across accounts; no account or decision ids; a row is readable only once at least 2 accounts contributed'
  WHERE table_name = 'cross_account_precedent_stats';
