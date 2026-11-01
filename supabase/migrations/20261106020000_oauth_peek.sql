-- User & data isolation, front 4: a tool connection can only be completed by the account that started it.
--
-- Until now the provider (Slack, Gmail, Notion, Canva, Figma, Shopify) sent the person's browser straight to a public callback that
-- finished the connection for whoever STARTED it. Someone who started a connection could therefore get another person to approve it at
-- the provider, and that person's tool was attached to the starter's account. Now the callback only hands the browser back to the app;
-- the app finishes the connection with a request signed in as the person in that browser, and the callback refuses it unless that person
-- is the one who started it.
--
-- peek_oauth_transaction(provider, state): who started this connection (and from which app address), WITHOUT using it up. The state is
-- still consumed, once, by the existing consume_<provider>_oauth_transaction when the connection is finished. Server only.
CREATE OR REPLACE FUNCTION public.peek_oauth_transaction(_provider text, _state text)
RETURNS TABLE(user_id uuid, request_origin text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _provider = 'slack' THEN
    RETURN QUERY SELECT t.user_id, t.request_origin FROM public.slack_oauth_transactions t WHERE t.state = _state AND t.expires_at > now();
  ELSIF _provider = 'canva' THEN
    RETURN QUERY SELECT t.user_id, t.request_origin FROM public.canva_oauth_transactions t WHERE t.state = _state AND t.expires_at > now();
  ELSIF _provider = 'notion' THEN
    RETURN QUERY SELECT t.user_id, t.request_origin FROM public.notion_oauth_transactions t WHERE t.state = _state AND t.expires_at > now();
  ELSIF _provider = 'shopify' THEN
    RETURN QUERY SELECT t.user_id, t.request_origin FROM public.shopify_oauth_transactions t WHERE t.state = _state AND t.expires_at > now();
  ELSIF _provider = 'gmail' THEN
    RETURN QUERY SELECT t.user_id, NULL::text FROM public.gmail_oauth_transactions t WHERE t.state = _state AND t.expires_at > now();
  ELSIF _provider = 'figma' THEN
    RETURN QUERY SELECT t.user_id, NULL::text FROM public.figma_oauth_transactions t WHERE t.state = _state AND t.expires_at > now();
  ELSE
    RAISE EXCEPTION 'unknown provider';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.peek_oauth_transaction(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peek_oauth_transaction(text, text) TO service_role;
