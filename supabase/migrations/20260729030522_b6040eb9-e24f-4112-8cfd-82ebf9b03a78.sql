
CREATE TABLE IF NOT EXISTS public.notion_oauth_transactions (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  request_origin text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.notion_oauth_transactions TO service_role;
ALTER TABLE public.notion_oauth_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_notion_oauth_transaction(_state text)
RETURNS TABLE(user_id uuid, request_origin text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  DELETE FROM public.notion_oauth_transactions t
  WHERE t.state = _state
    AND t.expires_at > now()
  RETURNING t.user_id, t.request_origin;
END;
$$;
