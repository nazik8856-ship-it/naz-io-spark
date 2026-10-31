-- User & data isolation, leftovers: 20261105040000 raises the cross-account stats minimum from 2 to 5 contributing accounts.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

DELETE FROM public.cross_account_precedent_stats;
INSERT INTO public.cross_account_precedent_stats (action_type, provider, total_count, non_allow_count, contributing_account_count) VALUES
  ('a', 'one', 5, 1, 1), ('a', 'two', 9, 2, 2), ('a', 'three', 40, 9, 3), ('a', 'four', 40, 9, 4), ('a', 'five', 40, 9, 5), ('a', 'nine', 90, 9, 9);

\ir ../../migrations/20261105040000_precedent_minimum_five.sql
\ir ../../migrations/20261105040000_precedent_minimum_five.sql

SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false); SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT pg_temp.check((SELECT array_agg(provider ORDER BY provider) FROM public.cross_account_precedent_stats) = ARRAY['five', 'nine'],
  'a signed-in user sees only combinations that 5 or more accounts contributed to (2, 3 and 4 are hidden now)');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.cross_account_precedent_stats) = 6, 'the server still sees every row');
SELECT pg_temp.check((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.cross_account_precedent_stats'::regclass AND polcmd = 'r') = 1, 'one read rule, repeated runs do not stack them');
SELECT pg_temp.check((SELECT read_all_reason FROM public.isolation_tables WHERE table_name = 'cross_account_precedent_stats') LIKE '%at least 5 accounts%', 'the register says 5');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.isolation_report() WHERE object LIKE 'cross_account_precedent_stats%'), 'and the report has no complaint about it');
SELECT 'isolation_precedent_min_test: all checks passed' AS result;
