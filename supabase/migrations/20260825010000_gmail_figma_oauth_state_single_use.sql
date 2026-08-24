-- 2026-08-25 plan item 7: make Gmail and Figma's OAuth `state` single-use.
--
-- Confirmed (and self-documented in both callback files): gmail-oauth-
-- callback / figma-oauth-callback share a `verifyState` helper that checks
-- only an HMAC signature + a 10-minute `iat` expiry -- no DB row is ever
-- consulted or consumed, unlike Canva/Notion/Shopify/Slack's real one-time
-- consume_*_oauth_transaction pattern (see 20260729030522 for Notion's
-- exact shape, mirrored here). A leaked/replayed state (browser history,
-- proxy logs, a referrer header) is redeemable more than once inside its
-- 10-minute window today.
--
-- Gmail/Figma's state is a self-contained signed JSON blob (not a short
-- opaque random token like the other four providers'), so the full state
-- string is used as the primary key here rather than minting a separate
-- token -- same one-row-per-outstanding-state, consumed-via-atomic-DELETE
-- shape as the other four, just keyed on the value that already exists.
-- verifyState's own HMAC check stays in place in both callbacks -- this is
-- defense in depth, not a replacement.
CREATE TABLE IF NOT EXISTS public.gmail_oauth_transactions (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.gmail_oauth_transactions TO service_role;
ALTER TABLE public.gmail_oauth_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_gmail_oauth_transaction(_state text)
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  DELETE FROM public.gmail_oauth_transactions t
  WHERE t.state = _state
    AND t.expires_at > now()
  RETURNING t.user_id;
END;
$$;

CREATE TABLE IF NOT EXISTS public.figma_oauth_transactions (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.figma_oauth_transactions TO service_role;
ALTER TABLE public.figma_oauth_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_figma_oauth_transaction(_state text)
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  DELETE FROM public.figma_oauth_transactions t
  WHERE t.state = _state
    AND t.expires_at > now()
  RETURNING t.user_id;
END;
$$;
