-- User & data isolation, front 2: 20261105010000 (the public-site lookup, team read access) and 20261105020000 (the gaps closed).
-- People: A owns site 1, B owns site 2, V is a team viewer of A, T is a team member of both A and B, and a visitor has no sign-in.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.throws(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
CREATE OR REPLACE FUNCTION pg_temp.has_gap(_kind text, _object text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.isolation_report() WHERE kind = _kind AND object LIKE _object); END $$;

-- The tables and rules as they are live (reduced to what these migrations touch).
DROP TABLE IF EXISTS public.website_pages, public.websites, public.shared_websites, public.hard_rules, public.cross_account_precedent_stats, public.user_roles CASCADE;
CREATE TABLE public.websites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL DEFAULT '', name text, tagline text,
  theme jsonb NOT NULL DEFAULT '{}', images_status text, subdomain text, custom_domain text, prompt text, generation_notes jsonb NOT NULL DEFAULT '{}', trust_score integer);
CREATE TABLE public.website_pages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  slug text NOT NULL, title text, seo_description text, sections jsonb NOT NULL DEFAULT '[]', order_index integer NOT NULL DEFAULT 0);
CREATE TABLE public.shared_websites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), html text NOT NULL, title text, user_id uuid NOT NULL);
CREATE TABLE public.hard_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, rule_text text);
CREATE TABLE public.cross_account_precedent_stats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_type text NOT NULL, provider text, total_count integer NOT NULL,
  non_allow_count integer NOT NULL, contributing_account_count integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN CREATE TYPE public.app_role AS ENUM ('admin', 'owner', 'user'); END IF; END $$;
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
-- The seven functions live, with the grants they have live (everyone can call them), and the old unchecked has_role.
DROP FUNCTION IF EXISTS public.build_policy_snapshot(uuid), public.delete_expired_agent_events(uuid, timestamptz), public.get_active_policy_version(uuid),
  public.increment_clean_allow_count(uuid, uuid, timestamptz), public.increment_ip_rate_limit(text, text, timestamptz),
  public.increment_rate_limit(uuid, text, timestamptz), public.sweep_stale_generation_progress(), public.has_role(uuid, public.app_role);
CREATE FUNCTION public.build_policy_snapshot(_user_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.delete_expired_agent_events(_user_id uuid, _cutoff timestamptz) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.get_active_policy_version(_user_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.increment_clean_allow_count(_user_id uuid, _api_key_id uuid, _window_start timestamptz) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT 1 $$;
CREATE FUNCTION public.increment_ip_rate_limit(_ip text, _endpoint text, _window_start timestamptz) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT 1 $$;
CREATE FUNCTION public.increment_rate_limit(_user_id uuid, _endpoint text, _window_start timestamptz) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT 1 $$;
CREATE FUNCTION public.sweep_stale_generation_progress() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.build_policy_snapshot(uuid), public.delete_expired_agent_events(uuid, timestamptz), public.get_active_policy_version(uuid),
  public.increment_clean_allow_count(uuid, uuid, timestamptz), public.increment_ip_rate_limit(text, text, timestamptz),
  public.increment_rate_limit(uuid, text, timestamptz), public.sweep_stale_generation_progress(), public.has_role(uuid, public.app_role) TO PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY; ALTER TABLE public.website_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_websites ENABLE ROW LEVEL SECURITY; ALTER TABLE public.hard_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cross_account_precedent_stats ENABLE ROW LEVEL SECURITY; ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view a website by its link" ON public.websites FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Users can view their own websites" ON public.websites FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own websites" ON public.websites FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone can view pages of a website by its link" ON public.website_pages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Owners manage their website pages" ON public.website_pages FOR ALL USING (EXISTS (SELECT 1 FROM public.websites w WHERE w.id = website_pages.website_id AND w.user_id = auth.uid()));
CREATE POLICY "Anyone can view shared websites" ON public.shared_websites FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Team owners can manage owner's hard rules" ON public.hard_rules FOR ALL TO authenticated USING (is_account_member(user_id, 'owner', 'policy')) WITH CHECK (is_account_member(user_id, 'owner', 'policy'));
CREATE POLICY "Any authenticated user can read coarse cross-account precedent " ON public.cross_account_precedent_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Platform staff can see roles" ON public.user_roles FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
GRANT ALL ON public.websites, public.website_pages, public.shared_websites, public.hard_rules, public.cross_account_precedent_stats, public.user_roles TO anon, authenticated, service_role;

\ir ../../migrations/20261104020000_isolation_register.sql
TRUNCATE public.account_members;
DELETE FROM public.webhooks;
INSERT INTO public.account_members (account_owner_id, member_id, email, role, status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c3', 'v@x.test', 'viewer', 'active'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d4', 't@x.test', 'owner', 'active'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d4', 't@x.test', 'owner', 'active');
INSERT INTO public.websites (id, user_id, name, tagline, theme, images_status, subdomain, custom_domain, prompt, generation_notes, trust_score) VALUES
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Acme Bikes', 'We fix bikes', '{"palette":"warm"}', 'done', 'acme', 'Acme.Example.com',
   'SECRET PROMPT of A', '{"notes":"SECRET NOTES"}', 91),
  ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'Bee Honey', 'Sweet', '{}', NULL, NULL, NULL, 'B prompt', '{}', 50);
INSERT INTO public.website_pages (website_id, slug, title, sections, order_index) VALUES
  ('80000000-0000-0000-0000-000000000001', 'about', 'About', '[{"type":"text"}]', 2), ('80000000-0000-0000-0000-000000000001', 'home', 'Home', '[{"type":"hero"}]', 1),
  ('80000000-0000-0000-0000-000000000002', 'home', 'B home', '[]', 1);
INSERT INTO public.shared_websites (id, html, title, user_id) VALUES ('90000000-0000-0000-0000-000000000001', '<p>shared</p>', 'S', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.hard_rules (id, user_id, rule_text) VALUES ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'never quote prices');
INSERT INTO public.cross_account_precedent_stats (action_type, provider, total_count, non_allow_count, contributing_account_count) VALUES
  ('send_email', 'gmail', 5, 1, 1), ('send_email', 'slack', 40, 9, 3);
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');

-- ===== Part 1: the lookup and team read access, applied twice (it must be repeatable) =====================================
\ir ../../migrations/20261105010000_public_site_lookup.sql
\ir ../../migrations/20261105010000_public_site_lookup.sql

-- A visitor (no sign-in) opens one site by its id, subdomain or custom domain and gets only what the preview shows.
SET ROLE anon; SELECT set_config('request.jwt.claim.role', 'anon', false); SELECT set_config('request.jwt.claim.sub', '', false);
SELECT pg_temp.check(public.get_public_site('80000000-0000-0000-0000-000000000001') ->> 'name' = 'Acme Bikes', 'a visitor opens a site by its id');
SELECT pg_temp.check(public.get_public_site('acme') ->> 'id' = '80000000-0000-0000-0000-000000000001', 'by its subdomain');
SELECT pg_temp.check(public.get_public_site('ACME.example.COM') ->> 'id' = '80000000-0000-0000-0000-000000000001', 'by its custom domain, in any letter case');
SELECT pg_temp.check((SELECT array_agg(p ->> 'slug' ORDER BY ord) FROM jsonb_array_elements(public.get_public_site('acme') -> 'pages') WITH ORDINALITY AS t(p, ord)) = ARRAY['home', 'about'],
  'with its pages in order');
SELECT pg_temp.check((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.get_public_site('acme')) k) = ARRAY['id', 'images_status', 'name', 'pages', 'tagline', 'theme'],
  'and only the fields the preview renders');
SELECT pg_temp.check((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.get_public_site('acme') -> 'pages' -> 0) k) = ARRAY['id', 'order_index', 'sections', 'seo_description', 'slug', 'title'],
  'page fields: no owner');
SELECT pg_temp.check(public.get_public_site('acme')::text !~* '(SECRET|user_id|prompt|generation_notes|trust_score)', 'never the owner, prompt, notes or score');
SELECT pg_temp.check(NOT (public.get_public_site('acme', true) ? 'pages') AND public.get_public_site('acme', true) ->> 'tagline' = 'We fix bikes', 'meta only leaves the pages out');
SELECT pg_temp.check(public.get_public_site('80000000-0000-0000-0000-0000000000ff') IS NULL, 'an unknown id finds nothing');
SELECT pg_temp.check(public.get_public_site('nope') IS NULL AND public.get_public_site('') IS NULL AND public.get_public_site(NULL) IS NULL, 'so do an unknown name, an empty one and none');
SELECT pg_temp.check(public.get_public_site('%') IS NULL AND public.get_public_site('acm_') IS NULL, 'and a pattern does not list sites');
SELECT pg_temp.check(public.get_public_site(repeat('a', 300)) IS NULL, 'or an overlong name');
RESET ROLE;

-- Team members read their account's sites on their own rights; strangers do not (checked once the open rules are gone, below).
SELECT pg_temp.check((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.websites'::regclass AND polname = 'Team members can view their account websites') = 1, 'team read policy on websites');
SELECT pg_temp.check((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.shared_websites'::regclass AND polname = 'Owners can view their shared websites') = 1, 'owner read policy on shared sites');

-- The report: the lookup is registered as public on purpose; the open rules and the seven functions are still there at this point.
SELECT pg_temp.check(NOT pg_temp.has_gap('unchecked_function', 'get_public_site%'), 'a registered public function is not reported');
SELECT pg_temp.check(pg_temp.has_gap('read_all', 'websites / Anyone can view a website by its link'), 'the open rule is still reported before part 2');
SELECT pg_temp.check(pg_temp.has_gap('unchecked_function', 'increment_rate_limit%'), 'and the unchecked counter');
SELECT pg_temp.check(pg_temp.has_gap('unchecked_function', 'has_role%'), 'and the unchecked has_role');
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.isolation_public_functions', 'SELECT') AND NOT has_table_privilege('anon', 'public.isolation_public_functions', 'SELECT'),
  'only the server reads the list of public functions');
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.can_access(uuid, text)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.can_access(uuid, text)', 'EXECUTE'), 'can_access is for signed-in users');

-- ===== Part 2: the gaps closed ===========================================================================================
\ir ../../migrations/20261105020000_isolation_close_gaps.sql
\ir ../../migrations/20261105020000_isolation_close_gaps.sql

-- Sites: nobody lists them any more. Owner A sees only A's; team viewer V sees A's; a stranger B sees only B's; a visitor sees none.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SELECT pg_temp.check((SELECT array_agg(id) FROM public.websites) = ARRAY['80000000-0000-0000-0000-000000000001'::uuid], 'A sees only A''s site');
SELECT pg_temp.check((SELECT count(*) FROM public.website_pages) = 2, 'and only A''s pages');
SELECT pg_temp.check((SELECT count(*) FROM public.shared_websites) = 1, 'and A''s shared site');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT pg_temp.check((SELECT array_agg(id) FROM public.websites) = ARRAY['80000000-0000-0000-0000-000000000002'::uuid], 'B sees only B''s site, not A''s prompt or notes');
SELECT pg_temp.check((SELECT count(*) FROM public.website_pages) = 1 AND (SELECT count(*) FROM public.shared_websites) = 0, 'and none of A''s pages or shared sites');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false);
SELECT pg_temp.check((SELECT array_agg(id) FROM public.websites) = ARRAY['80000000-0000-0000-0000-000000000001'::uuid], 'the team viewer of A reads A''s site');
SELECT pg_temp.check((SELECT count(*) FROM public.website_pages) = 2 AND (SELECT count(*) FROM public.shared_websites) = 1, 'and its pages and shared sites');
SELECT pg_temp.check(pg_temp.throws($$UPDATE public.websites SET name = 'hijacked' WHERE id = '80000000-0000-0000-0000-000000000001'$$) OR
  (SELECT name FROM public.websites WHERE id = '80000000-0000-0000-0000-000000000001') = 'Acme Bikes', 'but the viewer can not change it');
RESET ROLE;
SET ROLE anon; SELECT set_config('request.jwt.claim.role', 'anon', false); SELECT set_config('request.jwt.claim.sub', '', false);
SELECT pg_temp.check(pg_temp.throws('SELECT count(*) FROM public.websites') OR (SELECT count(*) FROM public.websites) = 0, 'a visitor lists no sites');
SELECT pg_temp.check(public.get_public_site('acme') ->> 'name' = 'Acme Bikes', 'but still opens one by its link');
RESET ROLE;

-- The seven server-only functions: no browser access; the server still has it.
SELECT pg_temp.check(NOT has_function_privilege(r, f, 'EXECUTE'), f || ' is closed to ' || r)
  FROM unnest(ARRAY['anon', 'authenticated']) r,
  unnest(ARRAY['public.build_policy_snapshot(uuid)', 'public.delete_expired_agent_events(uuid, timestamptz)', 'public.get_active_policy_version(uuid)',
    'public.increment_clean_allow_count(uuid, uuid, timestamptz)', 'public.increment_ip_rate_limit(text, text, timestamptz)',
    'public.increment_rate_limit(uuid, text, timestamptz)', 'public.sweep_stale_generation_progress()']) f;
SELECT pg_temp.check(has_function_privilege('service_role', f, 'EXECUTE'), f || ' still works for the server')
  FROM unnest(ARRAY['public.build_policy_snapshot(uuid)', 'public.delete_expired_agent_events(uuid, timestamptz)', 'public.get_active_policy_version(uuid)',
    'public.increment_clean_allow_count(uuid, uuid, timestamptz)', 'public.increment_ip_rate_limit(text, text, timestamptz)',
    'public.increment_rate_limit(uuid, text, timestamptz)', 'public.sweep_stale_generation_progress()']) f;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false); SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT pg_temp.check(pg_temp.throws($$SELECT public.increment_rate_limit('00000000-0000-0000-0000-0000000000a1', 'control-api', now())$$), 'B can not bump A''s rate-limit counter');
SELECT pg_temp.check(pg_temp.throws($$SELECT public.delete_expired_agent_events('00000000-0000-0000-0000-0000000000a1', now())$$), 'or delete A''s events');
RESET ROLE;
SET ROLE service_role; SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.check(public.increment_rate_limit('00000000-0000-0000-0000-0000000000a1', 'control-api', now()) = 1, 'the server key still bumps it');
RESET ROLE;

-- has_role: signed-in users and visitors learn only about themselves; the server and database jobs about anyone.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SELECT pg_temp.check(public.has_role('00000000-0000-0000-0000-0000000000a1', 'admin'), 'a user is told their own role');
SELECT pg_temp.check(NOT public.has_role('00000000-0000-0000-0000-0000000000a1', 'owner'), 'and that they lack one they lack');
SELECT pg_temp.check((SELECT count(*) FROM public.user_roles) = 1, 'a rule that uses has_role(auth.uid()) still works');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT pg_temp.check(NOT public.has_role('00000000-0000-0000-0000-0000000000a1', 'admin'), 'B can not ask whether A is an admin');
SELECT pg_temp.check((SELECT count(*) FROM public.user_roles) = 0, 'and a rule for admins shows B nothing');
RESET ROLE;
SET ROLE anon; SELECT set_config('request.jwt.claim.role', 'anon', false); SELECT set_config('request.jwt.claim.sub', '', false);
SELECT pg_temp.check(NOT public.has_role('00000000-0000-0000-0000-0000000000a1', 'admin'), 'a visitor learns nothing');
RESET ROLE;
SET ROLE service_role; SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.check(public.has_role('00000000-0000-0000-0000-0000000000a1', 'admin'), 'the server key may ask about anyone');
RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);
SELECT pg_temp.check(public.has_role('00000000-0000-0000-0000-0000000000a1', 'admin'), 'and so may a database job');

-- Owners can not be changed by a signed-in user. T is a team member of both A and B: the rule alone would let T move A's rule to B.
SELECT pg_temp.check((SELECT count(*) FROM pg_trigger WHERE tgname = 'prevent_owner_change' AND tgrelid IN ('public.websites'::regclass, 'public.hard_rules'::regclass, 'public.shared_websites'::regclass, 'public.webhooks'::regclass, 'public.website_pages'::regclass)) = 5,
  'the guard is on every registered table that exists');
ALTER TABLE public.hard_rules DISABLE TRIGGER prevent_owner_change;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false); SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', false);
UPDATE public.hard_rules SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT user_id FROM public.hard_rules WHERE id = 'a0000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-0000000000b2', 'without the guard the rule moves to B (the gap that was open)');
RESET ROLE;
UPDATE public.hard_rules SET user_id = '00000000-0000-0000-0000-0000000000a1' WHERE id = 'a0000000-0000-0000-0000-000000000001';
ALTER TABLE public.hard_rules ENABLE TRIGGER prevent_owner_change;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false); SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', false);
SELECT pg_temp.check(pg_temp.throws($$UPDATE public.hard_rules SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = 'a0000000-0000-0000-0000-000000000001'$$), 'with the guard the move is refused');
SELECT pg_temp.check(NOT pg_temp.throws($$UPDATE public.hard_rules SET rule_text = 'never quote discounts' WHERE id = 'a0000000-0000-0000-0000-000000000001'$$), 'while editing the rule itself still works');
SELECT pg_temp.check((SELECT rule_text FROM public.hard_rules WHERE id = 'a0000000-0000-0000-0000-000000000001') = 'never quote discounts', 'and is saved');
SELECT pg_temp.check(NOT pg_temp.throws($$UPDATE public.hard_rules SET user_id = user_id, rule_text = 'x' WHERE id = 'a0000000-0000-0000-0000-000000000001'$$), 'writing the same owner again (an upsert) is fine');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SELECT pg_temp.check(pg_temp.throws($$UPDATE public.websites SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = '80000000-0000-0000-0000-000000000001'$$), 'an owner can not give a site away');
SELECT pg_temp.check(NOT pg_temp.throws($$UPDATE public.websites SET name = 'Acme Cycles' WHERE id = '80000000-0000-0000-0000-000000000001'$$), 'but can rename it');
RESET ROLE;
SET ROLE service_role; SELECT set_config('request.jwt.claim.role', 'service_role', false);
UPDATE public.hard_rules SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT user_id FROM public.hard_rules WHERE id = 'a0000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-0000000000b2', 'the server key may change an owner');
RESET ROLE;

-- The cross-account stats: a row shows only once at least 2 accounts contributed.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false); SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT pg_temp.check((SELECT array_agg(provider) FROM public.cross_account_precedent_stats) = ARRAY['slack'], 'a combination with one contributing account is hidden from signed-in users');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.cross_account_precedent_stats) = 2, 'the server still sees both rows');

-- The report: the gaps this front closes are gone.
SELECT pg_temp.check(NOT pg_temp.has_gap('read_all', 'websites%') AND NOT pg_temp.has_gap('read_all', 'website_pages%') AND NOT pg_temp.has_gap('read_all', 'shared_websites%'), 'no read-everything rule on the three tables');
SELECT pg_temp.check(NOT pg_temp.has_gap('unchecked_function', 'increment%') AND NOT pg_temp.has_gap('unchecked_function', 'delete_expired%')
  AND NOT pg_temp.has_gap('unchecked_function', 'sweep_stale%') AND NOT pg_temp.has_gap('unchecked_function', 'build_policy%') AND NOT pg_temp.has_gap('unchecked_function', 'get_active%'),
  'the six closed functions are not reported');
SELECT pg_temp.check(NOT pg_temp.has_gap('unchecked_function', 'has_role%'), 'has_role now checks the caller');
SELECT pg_temp.check(NOT pg_temp.has_gap('no_identity_check', 'cross_account_precedent_stats%'), 'a table that is open on purpose, with a reason, is not reported for it');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.isolation_report() WHERE kind = 'owner_unguarded' AND object IN ('websites.user_id', 'website_pages.user_id', 'shared_websites.user_id', 'hard_rules.user_id', 'webhooks.user_id')),
  'every owner column is guarded');
CREATE TABLE public.isolation_probe (id uuid PRIMARY KEY, user_id uuid NOT NULL);
INSERT INTO public.isolation_tables (table_name, access, owner_column) VALUES ('isolation_probe', 'owner', 'user_id');
SELECT pg_temp.check(pg_temp.has_gap('owner_unguarded', 'isolation_probe.user_id'), 'a new table without the guard is reported');
DROP TABLE public.isolation_probe;
DELETE FROM public.isolation_tables WHERE table_name = 'isolation_probe';
