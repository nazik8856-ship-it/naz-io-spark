-- Secrets handling, front 1: after 20261030010000 no browser role can read a secret column, and every query the website makes
-- still works. Run against a database with the Supabase-like baseline (roles, auth.uid(), the tables) and the migration applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/secrets/column_grants_test.sql
-- Each check raises an exception when it fails.
\set ON_ERROR_STOP 1
RESET ROLE;
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
INSERT INTO public.account_members (account_owner_id, member_id, email, role, status, invite_token)
  VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'b@example.com', 'viewer', 'active', 'invite-secret-1');
INSERT INTO public.agent_integrations (user_id, provider, credentials, status) VALUES ('00000000-0000-0000-0000-00000000000a', 'Notion', '{"access_token":"legacy"}', 'connected');
INSERT INTO public.api_keys (user_id, name, key_prefix, key_hash, callback_secret) VALUES ('00000000-0000-0000-0000-00000000000a', 'k', 'nz_ab', 'hash', 'cb-secret');
INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES ('unsub-secret', 'a@example.com');

-- 1. The exposure report is empty.
SET ROLE service_role;
DO $$ BEGIN IF (SELECT count(*) FROM public.secrets_exposure_report()) <> 0 THEN RAISE EXCEPTION 'exposure report not empty: %', (SELECT string_agg(table_name || '.' || column_name || ' ' || readable_by, ', ') FROM public.secrets_exposure_report()); END IF; END $$;
RESET ROLE;

-- 2. A signed-in owner reads exactly what the website reads, and is refused every secret column.
CREATE OR REPLACE FUNCTION pg_temp.expect_denied(q text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE q; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
  RAISE EXCEPTION 'expected permission denied for: %', q;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.agent_integrations) <> 1 THEN RAISE EXCEPTION 'owner should see the integration'; END IF;
END $$;
SELECT provider, status, metadata, last_verified_at, last_error FROM public.agent_integrations;
SELECT id, member_id, email, role, status, invited_at, accepted_at, ooo_until, ooo_fallback_member_id, permissions FROM public.account_members;
SELECT id, name, key_prefix, scopes, last_used_at, revoked_at, expires_at, created_at, on_uncertain FROM public.api_keys;
SELECT id, url, events, enabled, created_at FROM public.webhooks;
UPDATE public.account_members SET permissions = ARRAY['policy'] WHERE member_id = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect_denied('SELECT credentials FROM public.agent_integrations');
SELECT pg_temp.expect_denied('SELECT invite_token FROM public.account_members');
SELECT pg_temp.expect_denied('SELECT key_hash FROM public.api_keys');
SELECT pg_temp.expect_denied('SELECT callback_secret FROM public.api_keys');
SELECT pg_temp.expect_denied('SELECT secret FROM public.webhooks');
SELECT pg_temp.expect_denied('SELECT * FROM public.agent_integrations');
SELECT pg_temp.expect_denied('SELECT token FROM public.email_unsubscribe_tokens');
SELECT pg_temp.expect_denied($q$INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES ('forged', 'x@example.com')$q$);

-- 3. A team member still sees the owner's integration (without its credentials) and their own membership.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.agent_integrations) <> 1 THEN RAISE EXCEPTION 'team member should see the owner''s integration'; END IF;
  IF (SELECT count(*) FROM public.account_members) <> 1 THEN RAISE EXCEPTION 'member should see their membership'; END IF;
END $$;
RESET ROLE;

-- 4. Anonymous visitors read none of it.
SET ROLE anon;
SELECT pg_temp.expect_denied('SELECT key_hash FROM public.api_keys');
SELECT pg_temp.expect_denied('SELECT id FROM public.api_keys');
SELECT pg_temp.expect_denied('SELECT invite_token FROM public.account_members');
SELECT pg_temp.expect_denied('SELECT id FROM public.agent_integrations');
SELECT pg_temp.expect_denied('SELECT token FROM public.email_unsubscribe_tokens');
RESET ROLE;

-- 5. The server (service role) still reads and writes everything it uses.
SET ROLE service_role;
SELECT invite_token FROM public.account_members;
SELECT callback_secret, key_hash FROM public.api_keys;
INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES ('server-made', 'c@example.com');
SELECT token FROM public.email_unsubscribe_tokens;
RESET ROLE;
\echo 'column_grants_test: all checks passed'
