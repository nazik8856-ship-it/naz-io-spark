-- Secrets handling, front 1: 20261030030000 refuses to drop agent_integrations.credentials while it holds a value (and drops
-- nothing), and drops it once it is empty. Runs the real migration file both times.
\set ON_ERROR_STOP 1
RESET ROLE;
TRUNCATE public.agent_integrations;
INSERT INTO public.agent_integrations (user_id, provider, credentials) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Notion', '{"access_token":"x"}');
-- 1. With a value present the migration raises (expected: one ERROR line in the output) and the column stays.
\set ON_ERROR_STOP 0
\echo 'expected refusal follows:'
\ir ../../migrations/20261030030000_drop_unused_credentials_column.sql
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_integrations' AND column_name = 'credentials') THEN
    RAISE EXCEPTION 'FAILED: the column was dropped while it held a value';
  END IF;
END $$;
-- 2. Empty: the column goes. 3. Again: nothing to do, no error.
UPDATE public.agent_integrations SET credentials = '{}';
\ir ../../migrations/20261030030000_drop_unused_credentials_column.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_integrations' AND column_name = 'credentials') THEN
    RAISE EXCEPTION 'FAILED: the empty column was not dropped';
  END IF;
END $$;
\ir ../../migrations/20261030030000_drop_unused_credentials_column.sql
\echo 'drop_credentials_column_test: all checks passed'
