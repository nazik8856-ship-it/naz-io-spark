-- User & data isolation, front 1: 20261104020000 gives website pages an owner that can't be set to another account, registers
-- every table, and isolation_report() names each kind of gap.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.has_gap(_kind text, _object text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.isolation_report() WHERE kind = _kind AND object LIKE _object); END $$;

-- The website tables as they are live (reduced to what this migration uses), with the two pages of user A's site.
DROP TABLE IF EXISTS public.website_pages, public.websites CASCADE;
CREATE TABLE public.websites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text);
CREATE TABLE public.website_pages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE, slug text);
ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view a website by its link" ON public.websites FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.websites (id, user_id) VALUES ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1'),
  ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.website_pages (website_id, slug) VALUES ('80000000-0000-0000-0000-000000000001', 'home'), ('80000000-0000-0000-0000-000000000001', 'about');

\ir ../../migrations/20261104020000_isolation_register.sql
\ir ../../migrations/20261104020000_isolation_register.sql

-- Website pages: existing pages got their owner; a new page takes the website's owner, whatever the writer sends.
SELECT pg_temp.check((SELECT bool_and(user_id = '00000000-0000-0000-0000-0000000000a1') FROM public.website_pages), 'existing pages owned by the site owner');
INSERT INTO public.website_pages (website_id, slug, user_id) VALUES ('80000000-0000-0000-0000-000000000001', 'contact', '00000000-0000-0000-0000-0000000000b2');
SELECT pg_temp.check((SELECT user_id FROM public.website_pages WHERE slug = 'contact') = '00000000-0000-0000-0000-0000000000a1', 'an owner sent by the writer is replaced by the site owner');
UPDATE public.website_pages SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE slug = 'contact';
SELECT pg_temp.check((SELECT user_id FROM public.website_pages WHERE slug = 'contact') = '00000000-0000-0000-0000-0000000000a1', 'and can not be changed to another account');
UPDATE public.website_pages SET website_id = '80000000-0000-0000-0000-000000000002' WHERE slug = 'contact';
SELECT pg_temp.check((SELECT user_id FROM public.website_pages WHERE slug = 'contact') = '00000000-0000-0000-0000-0000000000b2', 'moving a page to another site moves its owner');
SELECT pg_temp.check((SELECT is_nullable FROM information_schema.columns WHERE table_name = 'website_pages' AND column_name = 'user_id') = 'NO', 'every page has an owner');

-- The register: every access type is known; owner/team tables name their owner column.
SELECT pg_temp.check((SELECT count(*) FROM public.isolation_tables) >= 100, 'all live tables registered');
SELECT pg_temp.check((SELECT access FROM public.isolation_tables WHERE table_name = 'website_pages') = 'public_by_link', 'website_pages registered');

-- The report names each kind of gap.
SELECT pg_temp.check(pg_temp.has_gap('read_all', 'websites / Anyone can view a website by its link'), 'a read-everything policy is reported');
SELECT pg_temp.check(NOT pg_temp.has_gap('unregistered_table', 'websites'), 'a registered table is not reported as unregistered');
CREATE TABLE public.isolation_probe (id uuid PRIMARY KEY, user_id uuid, note text);
SELECT pg_temp.check(pg_temp.has_gap('unregistered_table', 'isolation_probe'), 'a new table missing from the register is reported');
SELECT pg_temp.check(pg_temp.has_gap('rls_off', 'isolation_probe'), 'and so is row level security being off');
INSERT INTO public.isolation_tables (table_name, access, owner_column) VALUES ('isolation_probe', 'team', 'user_id');
ALTER TABLE public.isolation_probe ENABLE ROW LEVEL SECURITY;
SELECT pg_temp.check(pg_temp.has_gap('owner_nullable', 'isolation_probe.user_id'), 'an owner column that can be empty is reported');
ALTER TABLE public.isolation_probe ALTER COLUMN user_id SET NOT NULL;
CREATE POLICY probe_any_note ON public.isolation_probe FOR SELECT TO authenticated USING (note IS NOT NULL);
SELECT pg_temp.check(pg_temp.has_gap('no_identity_check', 'isolation_probe / probe_any_note'), 'a policy that checks no identity is reported');
DROP POLICY probe_any_note ON public.isolation_probe;
CREATE POLICY probe_owner ON public.isolation_probe FOR SELECT TO authenticated USING (auth.uid() = user_id OR is_account_member(user_id));
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.isolation_report() WHERE object LIKE 'isolation_probe%'), 'an owner-checked, registered table has no gaps');
UPDATE public.isolation_tables SET access = 'system_only' WHERE table_name = 'isolation_probe';
SELECT pg_temp.check(pg_temp.has_gap('system_table_exposed', 'isolation_probe / probe_owner'), 'a system table reachable from the browser is reported');
CREATE FUNCTION public.isolation_probe_rows(_user_id uuid) RETURNS SETOF public.isolation_probe LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.isolation_probe WHERE user_id = _user_id $$;
GRANT EXECUTE ON FUNCTION public.isolation_probe_rows(uuid) TO authenticated;
SELECT pg_temp.check(pg_temp.has_gap('unchecked_function', 'isolation_probe_rows(uuid)'), 'a SECURITY DEFINER function that trusts its _user_id argument is reported');
REVOKE EXECUTE ON FUNCTION public.isolation_probe_rows(uuid) FROM PUBLIC, authenticated;
SELECT pg_temp.check(NOT pg_temp.has_gap('unchecked_function', 'isolation_probe_rows(uuid)'), 'not once only the server can call it');
DROP FUNCTION public.isolation_probe_rows(uuid);
DROP TABLE public.isolation_probe;
SELECT pg_temp.check(pg_temp.has_gap('unregistered_table', 'isolation_probe'), 'a registered table that no longer exists is reported');
DELETE FROM public.isolation_tables WHERE table_name = 'isolation_probe';

-- Only the server may read the register and run the report.
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.isolation_report()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.isolation_report()', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.isolation_tables', 'SELECT'), 'server only');

SELECT 'isolation_register_test: all checks passed';
