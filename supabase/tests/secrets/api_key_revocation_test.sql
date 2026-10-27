-- Secrets handling, front 3: a revoked (or expired) API key stops working on its very next request. Every API entry point
-- (control-api, outer-control) authenticates through resolveApiKeyAuth, which calls resolve_api_key on every request with no
-- cache; this checks the database side: the function below is the live definition (from 20260830070000), copied verbatim.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS last_used_at timestamptz, ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS scopes text[], ADD COLUMN IF NOT EXISTS paused_until timestamptz, ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.resolve_api_key(_key_hash text)
RETURNS TABLE(user_id uuid, key_id uuid, scopes text[], paused_until timestamptz, is_test boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  UPDATE public.api_keys k
  SET last_used_at = now()
  WHERE k.key_hash = _key_hash
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now())
  RETURNING k.user_id, k.id, k.scopes, k.paused_until, k.is_test;
END;
$$;

INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000e1') ON CONFLICT DO NOTHING;
INSERT INTO public.api_keys (user_id, name, key_hash) VALUES ('00000000-0000-0000-0000-0000000000e1', 'live key', 'hash-live'), ('00000000-0000-0000-0000-0000000000e1', 'expiring key', 'hash-exp');
SELECT set_config('request.jwt.claim.role', 'service_role', false);

SELECT pg_temp.check((SELECT count(*) FROM public.resolve_api_key('hash-live')) = 1, 'an active key authenticates');
UPDATE public.api_keys SET revoked_at = now() WHERE key_hash = 'hash-live';
SELECT pg_temp.check((SELECT count(*) FROM public.resolve_api_key('hash-live')) = 0, 'the next request after revoking is refused');
SELECT pg_temp.check((SELECT count(*) FROM public.resolve_api_key('hash-exp')) = 1, 'another key is unaffected');
UPDATE public.api_keys SET expires_at = now() - interval '1 second' WHERE key_hash = 'hash-exp';
SELECT pg_temp.check((SELECT count(*) FROM public.resolve_api_key('hash-exp')) = 0, 'an expired key is refused at once');
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ BEGIN PERFORM public.resolve_api_key('hash-exp'); RAISE EXCEPTION 'FAILED: a browser could call resolve_api_key'; EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FAILED:%' THEN RAISE; END IF; END $$;
SELECT set_config('request.jwt.claim.role', '', false);
\echo 'api_key_revocation_test: all checks passed'
