
CREATE TABLE public.shopify_oauth_transactions (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_domain text NOT NULL,
  request_origin text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.shopify_oauth_transactions TO service_role;
ALTER TABLE public.shopify_oauth_transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS shopify_oauth_transactions_expires_idx
  ON public.shopify_oauth_transactions (expires_at);

CREATE OR REPLACE FUNCTION public.consume_shopify_oauth_transaction(_state text)
RETURNS TABLE(user_id uuid, shop_domain text, request_origin text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  DELETE FROM public.shopify_oauth_transactions t
  WHERE t.state = _state
    AND t.expires_at > now()
  RETURNING t.user_id, t.shop_domain, t.request_origin;
END;
$$;
