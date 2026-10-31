-- User & data isolation, leftovers: the cross-account precedent stats show a row only once at least 5 accounts contributed (was 2).
-- With 2 contributors each could work out the other's numbers by subtracting their own; with 5 a contributor can not isolate anyone
-- else's share. 5 = MIN_CONTRIBUTING_ACCOUNTS in supabase/functions/_shared/cross-account-precedent.ts and src/lib/cross-account-precedent.ts
-- (src/test/data-isolation.test.ts keeps the three equal).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT polname FROM pg_policy WHERE polrelid = 'public.cross_account_precedent_stats'::regclass AND polcmd = 'r' LOOP
    EXECUTE format('DROP POLICY %I ON public.cross_account_precedent_stats', r.polname);
  END LOOP;
END $$;
CREATE POLICY "Read precedent once at least 5 accounts contributed" ON public.cross_account_precedent_stats
  FOR SELECT TO authenticated USING (contributing_account_count >= 5);
UPDATE public.isolation_tables SET read_all_reason = 'combined counts per action type across accounts; no account or decision ids; a row is readable only once at least 5 accounts contributed'
  WHERE table_name = 'cross_account_precedent_stats';
