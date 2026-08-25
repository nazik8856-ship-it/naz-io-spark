-- "Outer NazAI" plan, item 2: resolve_api_key() -- the atomic auth
-- resolution the public control-api edge function calls on every request.
--
-- A single UPDATE ... RETURNING does the lookup (by hash, active/
-- unexpired only) AND bumps last_used_at in the same statement -- no
-- separate SELECT-then-UPDATE, and no caching anywhere in this path, so a
-- revoked key stops authenticating on its very next call, not after some
-- TTL. Same atomic-single-statement shape as this project's
-- consume_*_oauth_transaction RPCs.
--
-- Service-role only: the edge function holds the raw presented key, hashes
-- it, and calls this with the hash -- never with anything a client-side
-- JWT holder could invoke directly (this must not be callable with a
-- guessed hash by an authenticated NazAI user probing for other accounts'
-- keys).
CREATE OR REPLACE FUNCTION public.resolve_api_key(_key_hash text)
RETURNS TABLE(user_id uuid, key_id uuid, scopes text[])
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
  RETURNING k.user_id, k.id, k.scopes;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_api_key(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_api_key(text) TO service_role;
