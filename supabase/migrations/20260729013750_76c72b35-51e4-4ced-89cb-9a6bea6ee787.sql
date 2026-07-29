CREATE TABLE public.canva_oauth_transactions (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
  scope_groups TEXT[] NOT NULL DEFAULT '{}',
  request_origin TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.canva_oauth_transactions TO service_role;

ALTER TABLE public.canva_oauth_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_canva_oauth_transaction(_state TEXT)
RETURNS TABLE(user_id UUID, code_verifier TEXT, scope_groups TEXT[], request_origin TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  DELETE FROM public.canva_oauth_transactions t
  WHERE t.state = _state
    AND t.expires_at > now()
  RETURNING t.user_id, t.code_verifier, t.scope_groups, t.request_origin;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_canva_oauth_transaction(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_canva_oauth_transaction(TEXT) TO service_role;

CREATE INDEX canva_oauth_transactions_expires_at_idx
  ON public.canva_oauth_transactions (expires_at);