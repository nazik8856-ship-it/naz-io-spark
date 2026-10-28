-- Data encryption, front 1: 20261101010000 keeps every stored delivery address https, whoever writes the row (here: the signed-in
-- owner writing straight to the table, the path the server functions' own checks do not cover).
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;
-- Runs the statement and reports whether the database refused it with a check violation.
CREATE OR REPLACE FUNCTION pg_temp.refused(stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RETURN false; EXCEPTION WHEN check_violation THEN RETURN true; END $$;
ALTER TABLE public.external_tools ADD COLUMN IF NOT EXISTS endpoint_url text;

\ir ../../migrations/20261101010000_https_only_addresses.sql
-- Applying it twice changes nothing.
\ir ../../migrations/20261101010000_https_only_addresses.sql

INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000d1') ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.refused($$INSERT INTO public.webhooks (user_id, url, secret) VALUES ('00000000-0000-0000-0000-0000000000d1', 'http://hooks.example.com/x', '')$$), 'the owner can not store a plain http webhook address');
INSERT INTO public.webhooks (id, user_id, url, secret) VALUES ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'https://hooks.example.com/x', '');
SELECT pg_temp.check(pg_temp.refused($$UPDATE public.webhooks SET url = 'http://hooks.example.com/y' WHERE id = '40000000-0000-0000-0000-000000000001'$$), 'nor change one to http');
UPDATE public.webhooks SET url = 'HTTPS://hooks.example.com/z' WHERE id = '40000000-0000-0000-0000-000000000001';
RESET ROLE;

SELECT pg_temp.check(pg_temp.refused($$INSERT INTO public.api_keys (user_id, name, key_hash, callback_url) VALUES ('00000000-0000-0000-0000-0000000000d1', 'k', 'h1', 'http://cb.example.com')$$), 'a plain http callback address is refused');
INSERT INTO public.api_keys (user_id, name, key_hash, callback_url) VALUES ('00000000-0000-0000-0000-0000000000d1', 'k', 'h2', 'https://cb.example.com'), ('00000000-0000-0000-0000-0000000000d1', 'k', 'h3', NULL), ('00000000-0000-0000-0000-0000000000d1', 'k', 'h4', '');
SELECT pg_temp.check(pg_temp.refused($$INSERT INTO public.external_tools (name, endpoint_url) VALUES ('t', 'http://tool.example.com')$$), 'a plain http tool address is refused');
INSERT INTO public.external_tools (name, endpoint_url) VALUES ('t1', 'https://tool.example.com'), ('t2', 'nazai-internal://report'), ('t3', 'nazai-agent://11111111-1111-1111-1111-111111111111');
SELECT pg_temp.check((SELECT count(*) FROM pg_constraint WHERE conname IN ('webhooks_url_https', 'api_keys_callback_url_https', 'external_tools_endpoint_https') AND convalidated) = 3, 'all three checks are in force');
\echo 'https_addresses_test: all checks passed'
