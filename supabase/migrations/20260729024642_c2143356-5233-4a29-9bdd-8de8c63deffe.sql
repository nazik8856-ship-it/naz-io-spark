
CREATE TABLE public.slack_oauth_transactions (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_groups text[] NOT NULL DEFAULT '{}',
  request_origin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

GRANT ALL ON public.slack_oauth_transactions TO service_role;

ALTER TABLE public.slack_oauth_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages slack oauth transactions"
  ON public.slack_oauth_transactions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consume_slack_oauth_transaction(_state text)
RETURNS TABLE(user_id uuid, scope_groups text[], request_origin text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  DELETE FROM public.slack_oauth_transactions t
  WHERE t.state = _state
    AND t.expires_at > now()
  RETURNING t.user_id, t.scope_groups, t.request_origin;
END;
$function$;
