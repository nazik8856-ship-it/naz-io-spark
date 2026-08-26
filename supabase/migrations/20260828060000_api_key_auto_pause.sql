-- "Zero human review" plan, item 7: today control-api-abuse-sweep
-- (20260826060000_control_api_abuse_alert.sql) only ever alerts a human
-- when a key looks like a leaked key being probed, or a misbehaving
-- integration in a retry storm -- exactly the wrong answer for a
-- fully-automated integration where nobody may be watching alerts at
-- all. Give the sweep permission to pause the key itself for a bounded
-- cooldown, mirroring the circuit breaker's own proven half-open-trial
-- recovery shape (control-gate.ts's BREAKER_COOLDOWN_MS), applied to a
-- whole key instead of one action type.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS pause_count integer NOT NULL DEFAULT 0;

-- resolve_api_key must now ALSO return paused_until (rather than filtering
-- a paused key out of the WHERE clause the way revoked_at/expires_at
-- already do) so control-api-auth.ts can tell "paused" apart from
-- "revoked/never existed" and return a specific, actionable message --
-- CREATE OR REPLACE can't change an existing function's RETURNS TABLE
-- column list, so the old signature is dropped first.
DROP FUNCTION IF EXISTS public.resolve_api_key(text);

CREATE FUNCTION public.resolve_api_key(_key_hash text)
RETURNS TABLE(user_id uuid, key_id uuid, scopes text[], paused_until timestamptz)
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
  RETURNING k.user_id, k.id, k.scopes, k.paused_until;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_api_key(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_api_key(text) TO service_role;
