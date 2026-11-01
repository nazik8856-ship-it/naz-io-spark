-- User & data isolation, front 4: 20261106020000 peek_oauth_transaction() says who started a connection without using the state up.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- the six state tables as they are live (reduced to what the function reads)
DO $$ DECLARE p text; BEGIN
  FOREACH p IN ARRAY ARRAY['slack', 'canva', 'notion', 'shopify', 'gmail', 'figma'] LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I', p || '_oauth_transactions');
    EXECUTE format('CREATE TABLE public.%I (state text PRIMARY KEY, user_id uuid NOT NULL, request_origin text, expires_at timestamptz NOT NULL DEFAULT now() + interval ''10 minutes'')', p || '_oauth_transactions');
    EXECUTE format('INSERT INTO public.%I (state, user_id, request_origin) VALUES (%L, %L, %L)', p || '_oauth_transactions', 'good-' || p, '00000000-0000-0000-0000-0000000000a1', 'https://nazai.net');
    EXECUTE format('INSERT INTO public.%I (state, user_id, expires_at) VALUES (%L, %L, now() - interval ''1 minute'')', p || '_oauth_transactions', 'old-' || p, '00000000-0000-0000-0000-0000000000a1');
  END LOOP;
END $$;
-- (canva and shopify have the extra columns the real tables have; the function does not read them)

\ir ../../migrations/20261106020000_oauth_peek.sql
\ir ../../migrations/20261106020000_oauth_peek.sql

SET ROLE service_role; SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.check((SELECT user_id FROM public.peek_oauth_transaction('slack', 'good-slack')) = '00000000-0000-0000-0000-0000000000a1', 'the server learns who started a Slack connection');
SELECT pg_temp.check((SELECT request_origin FROM public.peek_oauth_transaction('notion', 'good-notion')) = 'https://nazai.net', 'and from which app address');
SELECT pg_temp.check((SELECT count(*) FROM public.peek_oauth_transaction('gmail', 'good-gmail')) = 1 AND (SELECT request_origin FROM public.peek_oauth_transaction('gmail', 'good-gmail')) IS NULL, 'Gmail and Figma carry the address in the signed state, so none here');
SELECT pg_temp.check((SELECT count(*) FROM public.peek_oauth_transaction('figma', 'good-figma')) = 1, 'Figma too');
SELECT pg_temp.check((SELECT count(*) FROM public.peek_oauth_transaction('canva', 'good-canva')) = 1 AND (SELECT count(*) FROM public.peek_oauth_transaction('shopify', 'good-shopify')) = 1, 'Canva and Shopify');
SELECT pg_temp.check((SELECT count(*) FROM public.peek_oauth_transaction('slack', 'old-slack')) = 0, 'an expired state is not found');
SELECT pg_temp.check((SELECT count(*) FROM public.peek_oauth_transaction('slack', 'made-up')) = 0, 'neither is one that never existed');
SELECT pg_temp.check((SELECT count(*) FROM public.peek_oauth_transaction('slack', 'good-figma')) = 0, 'a state of one provider is not found under another');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.slack_oauth_transactions WHERE state = 'good-slack') = 1, 'looking does not use the state up');

-- nobody but the server may ask
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.peek_oauth_transaction(text, text)', 'EXECUTE'), 'a signed-in user can not call it');
RESET ROLE;
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.peek_oauth_transaction(text, text)', 'EXECUTE'), 'a visitor can not');
SELECT pg_temp.check((SELECT count(*) FROM public.isolation_report() WHERE object LIKE 'peek_oauth%') = 0, 'and the database report has no complaint about it');
-- an unknown provider is an error, not a guess at a table name
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN PERFORM * FROM public.peek_oauth_transaction('slack; drop table x', 's'); RAISE EXCEPTION 'FAILED: an unknown provider was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAILED%' THEN RAISE; END IF; END;
END $$;
SELECT 'oauth_peek_test: all checks passed' AS result;
