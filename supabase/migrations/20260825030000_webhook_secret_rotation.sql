-- 2026-08-25 plan item 9: a rotation path for outbound webhook secrets.
--
-- webhooks.secret is stored in plaintext on the row (not Vault) with no
-- rotate RPC or key-versioning. Rotating today means either an in-place
-- UPDATE with zero overlap (every delivery immediately starts signing with
-- a secret the receiver doesn't have yet, until they update in lockstep)
-- or delete-and-recreate (loses the webhook id and its webhook_deliveries
-- history). Scoped down from full key-id versioning like decision-signing
-- (item 15, 2026-08-24) since webhook signature verification, unlike
-- decision verification, has no historical rows to keep verifying against
-- -- only "in-flight during rotation" needs to keep working.
--
-- previous_secret / previous_secret_expires_at hold the just-rotated-out
-- secret for a bounded grace window. During that window every delivery
-- (see webhooks.ts / webhook-retry-sweep) signs with BOTH secrets and
-- sends the previous one under a second header, so the receiver can swap
-- in the new secret on their own schedule instead of at the exact moment
-- of rotation.
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS previous_secret text;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS previous_secret_expires_at timestamptz;

-- SECURITY DEFINER so the old-secret-into-previous_secret move is atomic
-- (a plain client-side read-then-update from the owner's own RLS-granted
-- UPDATE access would race against a delivery reading the row mid-swap).
-- The ownership check happens explicitly in the WHERE clause below, since
-- SECURITY DEFINER bypasses RLS -- mirrors approve_policy_change's own
-- internal-ownership-check shape.
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(_webhook_id uuid, _new_secret text, _grace_hours integer DEFAULT 24)
RETURNS TABLE(id uuid, secret text, previous_secret text, previous_secret_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _new_secret IS NULL OR length(_new_secret) < 16 THEN
    RAISE EXCEPTION 'new secret must be at least 16 characters';
  END IF;
  IF _grace_hours IS NULL OR _grace_hours < 0 OR _grace_hours > 168 THEN
    RAISE EXCEPTION 'grace_hours must be between 0 and 168';
  END IF;
  RETURN QUERY
  UPDATE public.webhooks w
  SET previous_secret = w.secret,
      previous_secret_expires_at = now() + (_grace_hours || ' hours')::interval,
      secret = _new_secret,
      updated_at = now()
  WHERE w.id = _webhook_id
    AND w.user_id = auth.uid()
  RETURNING w.id, w.secret, w.previous_secret, w.previous_secret_expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, text, integer) TO authenticated;
