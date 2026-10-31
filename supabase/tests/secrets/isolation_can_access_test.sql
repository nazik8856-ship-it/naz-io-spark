-- User & data isolation, leftovers of fronts 2 and 3: 20261105030000 moves the hand-written team rules onto can_access().
-- The point is "nothing changes for anyone": the same questions are asked of four people before and after, and the answers must match.
-- People (from isolation_front2_test.sql): A owns the rows, B is a stranger, V is a team viewer of A, T is an owner-role member of A and B.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- The membership check as it is live (the shared baseline's copy ignores the role and the permission).
CREATE OR REPLACE FUNCTION public.is_account_member(_account_owner_id uuid, _min_role text DEFAULT NULL, _permission text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE account_owner_id = _account_owner_id AND member_id = auth.uid() AND status = 'active'
      AND (_min_role IS NULL OR (_min_role = 'viewer') OR (_min_role = 'approver' AND role IN ('approver', 'owner')) OR (_min_role = 'owner' AND role = 'owner'))
      AND (_permission IS NULL OR permissions IS NULL OR _permission = ANY(permissions)))
$$;

-- hard_rules (from the earlier test) is missing the owner's own rule that the live table has.
DROP POLICY IF EXISTS "Users manage their own hard rules" ON public.hard_rules;
CREATE POLICY "Users manage their own hard rules" ON public.hard_rules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Team members can view owner's hard rules" ON public.hard_rules FOR SELECT TO authenticated USING (is_account_member(user_id));

-- One table for each shape of rule that exists live.
DROP TABLE IF EXISTS public.ca_view, public.ca_either, public.ca_manage, public.ca_ins, public.ca_notif, public.knowledge_base_entries CASCADE;
CREATE TABLE public.ca_view (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE public.ca_either (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE public.ca_manage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, txt text NOT NULL DEFAULT '');
CREATE TABLE public.ca_ins (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE public.ca_notif (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL, account_owner_id uuid NOT NULL);
CREATE TABLE public.knowledge_base_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
ALTER TABLE public.ca_view ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ca_either ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ca_manage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_ins ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ca_notif ENABLE ROW LEVEL SECURITY; ALTER TABLE public.knowledge_base_entries ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ca_view, public.ca_either, public.ca_manage, public.ca_ins, public.ca_notif, public.knowledge_base_entries TO anon, authenticated, service_role;

-- "Users manage their own X" + "Team members can view owner's X"
CREATE POLICY "own" ON public.ca_view FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Team members can view owner's x" ON public.ca_view FOR SELECT TO authenticated USING (is_account_member(user_id));
-- "Owners and team members read their X": the owner is in the rule itself
CREATE POLICY "Owners and team members read their x" ON public.ca_either FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR is_account_member(user_id)));
-- "Team owners can manage": role and permission, using and check
CREATE POLICY "own" ON public.ca_manage FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Team owners can manage owner's x" ON public.ca_manage FOR ALL TO authenticated
  USING (is_account_member(user_id, 'owner', 'policy')) WITH CHECK (is_account_member(user_id, 'owner', 'policy'));
-- separate create / update rules (check only / using and check)
CREATE POLICY "own" ON public.ca_ins FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Team owners can create owner's x" ON public.ca_ins FOR INSERT TO authenticated WITH CHECK (is_account_member(user_id, 'owner', 'spend'));
-- a recipient who is the owner or a member
CREATE POLICY "A recipient can manage their own preference" ON public.ca_notif FOR ALL TO authenticated
  USING (((auth.uid() = recipient_id) AND ((auth.uid() = account_owner_id) OR is_account_member(account_owner_id))))
  WITH CHECK (((auth.uid() = recipient_id) AND ((auth.uid() = account_owner_id) OR is_account_member(account_owner_id))));
-- the one live exception: team owners manage, the owner has no direct write access
CREATE POLICY "Team members can view owner's knowledge base entries" ON public.knowledge_base_entries FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR is_account_member(user_id)));
CREATE POLICY "Team owners can manage owner's knowledge base entries" ON public.knowledge_base_entries FOR ALL TO authenticated
  USING (is_account_member(user_id, 'owner', 'policy')) WITH CHECK (is_account_member(user_id, 'owner', 'policy'));

-- Rows: A's and B's of each, plus preferences of V and T for A.
INSERT INTO public.ca_view (user_id) VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.ca_either (user_id) VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.ca_manage (user_id) VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.knowledge_base_entries (user_id) VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.ca_notif (recipient_id, account_owner_id) VALUES
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1');

-- What a person can do, as one line: rows seen per table, rows they may change, whether they may create one.
CREATE OR REPLACE FUNCTION pg_temp.can_change(_table text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN EXECUTE format('WITH u AS (UPDATE public.%I SET user_id = user_id RETURNING 1) SELECT count(*) FROM u', _table) INTO n; RETURN n; END $$;
CREATE OR REPLACE FUNCTION pg_temp.can_create() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.ca_ins (id, user_id) VALUES ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1'); RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE OR REPLACE FUNCTION pg_temp.snapshot() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|',
    (SELECT count(*) FROM public.ca_view), (SELECT count(*) FROM public.ca_either), (SELECT count(*) FROM public.ca_manage), (SELECT count(*) FROM public.ca_notif),
    (SELECT count(*) FROM public.knowledge_base_entries), pg_temp.can_change('ca_manage'), pg_temp.can_change('ca_view'), pg_temp.can_create())
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_person(_sub text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false); PERFORM set_config('request.jwt.claim.sub', _sub, false);
  SET LOCAL ROLE authenticated;
  s := pg_temp.snapshot();
  RESET ROLE;
  DELETE FROM public.ca_ins WHERE id = 'f0000000-0000-0000-0000-000000000001';
  RETURN s;
END $$;

CREATE TEMP TABLE before_after (phase text, person text, answer text);
INSERT INTO before_after SELECT 'before', p, pg_temp.as_person(sub) FROM (VALUES
  ('A', '00000000-0000-0000-0000-0000000000a1'), ('B', '00000000-0000-0000-0000-0000000000b2'),
  ('V', '00000000-0000-0000-0000-0000000000c3'), ('T', '00000000-0000-0000-0000-0000000000d4')) AS x(p, sub);

-- ===== Apply it twice (it must be repeatable) ============================================================================
\ir ../../migrations/20261105030000_policies_use_can_access.sql
\ir ../../migrations/20261105030000_policies_use_can_access.sql

INSERT INTO before_after SELECT 'after', p, pg_temp.as_person(sub) FROM (VALUES
  ('A', '00000000-0000-0000-0000-0000000000a1'), ('B', '00000000-0000-0000-0000-0000000000b2'),
  ('V', '00000000-0000-0000-0000-0000000000c3'), ('T', '00000000-0000-0000-0000-0000000000d4')) AS x(p, sub);

SELECT pg_temp.check((SELECT count(*) FROM before_after) = 8, 'eight answers were taken');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM before_after b JOIN before_after a ON a.person = b.person AND a.phase = 'after' WHERE b.phase = 'before' AND a.answer <> b.answer),
  'every person gets exactly the same answers after the move');
-- ...and the answers are the ones the rules are meant to give (so "same" is not "same and wrong")
SELECT pg_temp.check((SELECT answer FROM before_after WHERE phase = 'after' AND person = 'A') = '1|1|1|1|1|1|1|t', 'A: own rows, may change own, may create');
SELECT pg_temp.check((SELECT answer FROM before_after WHERE phase = 'after' AND person = 'B') = '1|1|1|0|1|1|1|f', 'B: own rows only, not A''s preference, can not create one for A');
SELECT pg_temp.check((SELECT answer FROM before_after WHERE phase = 'after' AND person = 'V') = '1|1|0|1|1|0|0|f', 'V (viewer of A): reads A, changes nothing, can not create');
SELECT pg_temp.check((SELECT answer FROM before_after WHERE phase = 'after' AND person = 'T') = '2|2|2|1|2|2|0|t', 'T (owner role in A and B): reads and changes both accounts'' rules, may create');

-- The rules read can_access now; the one exception is the rule that gives the owner no direct access.
SELECT pg_temp.check((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.ca_view'::regclass AND pg_get_expr(polqual, polrelid) ~ 'can_access') = 1, 'view rule');
SELECT pg_temp.check((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.ca_either'::regclass) ~ '^(public[.])?can_access[(]user_id[)]$', 'owner-or-team becomes one call');
SELECT pg_temp.check((SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'public.ca_manage'::regclass AND polname LIKE 'Team owners%') ~ 'can_access\(user_id, ''owner''::text, ''policy''::text\)', 'role and permission carried over');
SELECT pg_temp.check((SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'public.ca_ins'::regclass AND polname LIKE 'Team owners%') ~ 'can_access\(user_id, ''owner''::text, ''spend''::text\)', 'insert rule too');
SELECT pg_temp.check((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.ca_notif'::regclass) ~ 'recipient_id\) AND (public[.])?can_access\(account_owner_id\)', 'recipient rule keeps its recipient check');
SELECT pg_temp.check((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.knowledge_base_entries'::regclass AND polcmd = '*' AND pg_get_expr(polqual, polrelid) ~ 'is_account_member') = 1,
  'the rule that gives the owner no direct access is left as it is');
SELECT pg_temp.check((SELECT polcmd FROM pg_policy WHERE polrelid = 'public.ca_view'::regclass AND polname = 'Team members can view owner''s x') = 'r', 'a rewritten rule keeps its command');
SELECT pg_temp.check((SELECT polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'public.ca_view'::regclass AND polname = 'Team members can view owner''s x') = '{authenticated}', 'and its roles');
-- Baseline rules (real tables) were rewritten too.
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname IN ('agent_integrations', 'api_keys', 'hard_rules') AND pg_get_expr(p.polqual, p.polrelid) ~ 'is_account_member'),
  'the rules on the real tables use can_access');

-- Can_access itself.
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.can_access(uuid, text, text)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.can_access(uuid, text, text)', 'EXECUTE'), 'the three-argument form is for signed-in users');
SELECT pg_temp.check(public.can_access(NULL, 'viewer', NULL) IS NOT TRUE, 'no owner: no access');
