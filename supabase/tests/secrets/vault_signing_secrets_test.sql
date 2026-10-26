-- Secrets handling, front 1: webhook and API-key callback secrets move into Vault (20261030020000). Seeds rows the old way
-- (plain columns), applies the migration, then checks: values moved and the plain columns emptied, rotation keeps the old secret
-- for the grace window without ever returning it, and a Vault secret disappears the moment no row points at it.
-- Run on a database with the Supabase-like baseline and 20261030010000 applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/secrets/vault_signing_secrets_test.sql
\set ON_ERROR_STOP 1
RESET ROLE;
-- A clean slate, so the Vault counts below are exact whatever ran before.
TRUNCATE public.webhooks, public.api_keys;
TRUNCATE vault.secrets;
INSERT INTO public.webhooks (id, user_id, url, secret, previous_secret, previous_secret_expires_at, events)
  VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'https://hooks.example.com/a', 'plain-current-secret-0001', 'plain-previous-secret-01', now() + interval '1 hour', '{decision.created}'),
         ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'https://hooks.example.com/b', 'plain-second-secret-00002', NULL, NULL, '{decision.created}');
INSERT INTO public.api_keys (id, user_id, name, key_hash, callback_url, callback_secret)
  VALUES ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'k', 'h', 'https://cb.example.com', 'plain-callback-secret-001');

\ir ../../migrations/20261030020000_signing_secrets_into_vault.sql

CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.vault_value(sid uuid) RETURNS text LANGUAGE sql AS $$ SELECT (secret::jsonb)->>'secret' FROM vault.secrets WHERE id = sid $$;

-- 1. Moved: the values are in Vault, the plain columns are empty.
SELECT pg_temp.check((SELECT secret = '' AND previous_secret IS NULL FROM public.webhooks WHERE id = '10000000-0000-0000-0000-000000000001'), 'webhook plain columns emptied');
SELECT pg_temp.check((SELECT pg_temp.vault_value(secret_id) FROM public.webhooks WHERE id = '10000000-0000-0000-0000-000000000001') = 'plain-current-secret-0001', 'current secret in Vault');
SELECT pg_temp.check((SELECT pg_temp.vault_value(previous_secret_id) FROM public.webhooks WHERE id = '10000000-0000-0000-0000-000000000001') = 'plain-previous-secret-01', 'previous secret in Vault');
SELECT pg_temp.check((SELECT callback_secret IS NULL AND pg_temp.vault_value(callback_secret_id) = 'plain-callback-secret-001' FROM public.api_keys WHERE id = '20000000-0000-0000-0000-000000000001'), 'callback secret in Vault');
SELECT pg_temp.check((SELECT count(*) FROM vault.secrets) = 4, 'four Vault secrets after the move');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.webhooks WHERE secret ~ 'plain' OR previous_secret ~ 'plain') AND NOT EXISTS (SELECT 1 FROM public.api_keys WHERE callback_secret ~ 'plain'), 'no plain value left anywhere');

-- 2. The server reads them through the existing service-role wrapper, as signing-secrets.ts does.
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.check((SELECT public.read_integration_secret(secret_id)->>'secret' FROM public.webhooks WHERE id = '10000000-0000-0000-0000-000000000002') = 'plain-second-secret-00002', 'read_integration_secret returns {secret}');
SELECT set_config('request.jwt.claim.role', '', false);
RESET ROLE;

-- 3. Rotation by the owner: the new secret comes back once, the old one never; old current becomes previous; the old previous is gone.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
CREATE TEMP TABLE rot AS SELECT * FROM public.rotate_webhook_secret('10000000-0000-0000-0000-000000000001', 'brand-new-secret-value-01', 24);
SELECT pg_temp.check((SELECT secret = 'brand-new-secret-value-01' AND previous_secret IS NULL AND previous_secret_expires_at > now() FROM rot), 'rotation returns only the new secret');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
SELECT pg_temp.check((SELECT count(*) FROM public.rotate_webhook_secret('10000000-0000-0000-0000-000000000001', 'attacker-secret-value-000', 24)) = 0, 'another user can not rotate it');
SELECT set_config('request.jwt.claim.sub', '', false);
RESET ROLE;
SELECT pg_temp.check((SELECT pg_temp.vault_value(secret_id) = 'brand-new-secret-value-01' AND pg_temp.vault_value(previous_secret_id) = 'plain-current-secret-0001' FROM public.webhooks WHERE id = '10000000-0000-0000-0000-000000000001'), 'rotation: new current, old current kept as previous');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE (secret::jsonb)->>'secret' = 'plain-previous-secret-01'), 'the rotated-out previous secret is deleted from Vault');
SELECT pg_temp.check((SELECT count(*) FROM vault.secrets) = 4, 'still four Vault secrets after rotation (one in, one out)');

-- 4. The sweep clearing an expired previous secret deletes it from Vault.
UPDATE public.webhooks SET previous_secret_id = NULL, previous_secret_expires_at = NULL WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE (secret::jsonb)->>'secret' = 'plain-current-secret-0001'), 'expired previous secret deleted from Vault');

-- 5. Deleting a webhook (as the website does) and an API key (as the retention sweep does) leaves nothing in Vault.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DELETE FROM public.webhooks WHERE id = '10000000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claim.sub', '', false);
RESET ROLE;
DELETE FROM public.api_keys WHERE id = '20000000-0000-0000-0000-000000000001';
DELETE FROM public.webhooks WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT count(*) FROM vault.secrets) = 0, 'no Vault secret left once no row points at it');

-- 6. Browsers still read none of it, the new id columns included.
SET ROLE service_role;
SELECT pg_temp.check((SELECT count(*) FROM public.secrets_exposure_report()) = 0, 'exposure report empty');
RESET ROLE;
SELECT pg_temp.check(NOT has_column_privilege('authenticated', 'public.webhooks', 'secret_id', 'SELECT') AND NOT has_column_privilege('authenticated', 'public.api_keys', 'callback_secret_id', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.webhooks', 'previous_secret_id', 'SELECT'), 'browsers can not read the Vault ids');
\echo 'vault_signing_secrets_test: all checks passed'
