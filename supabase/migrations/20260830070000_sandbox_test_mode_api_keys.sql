-- "Knowledge & autonomy" plan, item 7: sandbox (test-mode) API keys.
--
-- A test key behaves exactly like a real one through the gate and the
-- AI-scored judgment (same rules, same prompt, same verdict shape) but
-- must never count toward anything the platform treats as REAL evidence:
-- AI spend, embedding/precedent storage, calibration, automation-
-- readiness, or cross-account precedent sharing. is_test is the single
-- boolean threaded through every one of those call sites (see
-- _shared/sandbox-mode.ts) -- never a parallel code path.
--
-- agent_decisions.is_test mirrors the key's own flag onto every decision
-- it logs, so a real/test decision is distinguishable even in a report
-- that no longer has the originating api_keys row in scope (e.g. a
-- cross-account aggregate keyed only by user_id).
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.agent_decisions ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.api_keys.is_test IS
  'Sandbox/test-mode key: judged exactly like a real key, but its decisions never count toward real AI spend, precedent, calibration, or automation-readiness.';
COMMENT ON COLUMN public.agent_decisions.is_test IS
  'Mirrors the originating api_keys.is_test at the moment this decision was logged. Always false for a non-external-api decision.';

-- resolve_api_key now also returns is_test, so control-api's auth
-- resolution can thread it through without a second lookup. Its current
-- signature already carries paused_until (added by the auto-pause item,
-- 20260828060000_api_key_auto_pause.sql) -- CREATE OR REPLACE can't
-- change an existing function's RETURNS TABLE column list, so the old
-- signature is dropped first, same fix that migration itself already
-- documents and applies.
DROP FUNCTION IF EXISTS public.resolve_api_key(text);

CREATE FUNCTION public.resolve_api_key(_key_hash text)
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

REVOKE ALL ON FUNCTION public.resolve_api_key(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_api_key(text) TO service_role;
