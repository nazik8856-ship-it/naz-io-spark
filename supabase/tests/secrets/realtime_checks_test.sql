-- User & data isolation, front 4: 20261106010000 adds the live-update findings to isolation_report().
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.has_gap(_kind text, _object text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.isolation_report() WHERE kind = _kind AND object LIKE _object); END $$;

-- a Realtime-like setup: the publication and a messages table
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime;
CREATE SCHEMA IF NOT EXISTS realtime;
DROP TABLE IF EXISTS realtime.messages;
CREATE TABLE realtime.messages (id bigint PRIMARY KEY, topic text);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

\ir ../../migrations/20261106010000_realtime_checks.sql
\ir ../../migrations/20261106010000_realtime_checks.sql

-- nothing published, no broadcast rule: nothing to report
SELECT pg_temp.check(NOT pg_temp.has_gap('realtime_exposed', '%') AND NOT pg_temp.has_gap('realtime_broadcast_open', '%'), 'a clean setup reports nothing');

-- an owner table and a team table published: fine
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_integrations;   -- registered as owner
SELECT pg_temp.check(NOT pg_temp.has_gap('realtime_exposed', 'agent_integrations'), 'an owner table may be pushed live');

-- a platform-wide table published: reported
CREATE TABLE public.live_probe (id uuid PRIMARY KEY, user_id uuid NOT NULL);
ALTER TABLE public.live_probe ENABLE ROW LEVEL SECURITY;
INSERT INTO public.isolation_tables (table_name, access, owner_column) VALUES ('live_probe', 'platform', NULL);
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_probe;
SELECT pg_temp.check(pg_temp.has_gap('realtime_exposed', 'live_probe'), 'a platform table pushed live is reported');
-- an unregistered table published: reported too
UPDATE public.isolation_tables SET access = 'owner', owner_column = 'user_id' WHERE table_name = 'live_probe';
SELECT pg_temp.check(NOT pg_temp.has_gap('realtime_exposed', 'live_probe'), 'once it is an owner table it is fine');
DELETE FROM public.isolation_tables WHERE table_name = 'live_probe';
SELECT pg_temp.check(pg_temp.has_gap('realtime_exposed', 'live_probe'), 'a table with no registered access is reported');
ALTER PUBLICATION supabase_realtime DROP TABLE public.live_probe;
DROP TABLE public.live_probe;

-- an open broadcast rule: reported; a rule with a real condition is not
CREATE POLICY "anyone" ON realtime.messages FOR SELECT TO authenticated USING (true);
SELECT pg_temp.check(pg_temp.has_gap('realtime_broadcast_open', 'realtime.messages%'), 'an open broadcast rule is reported');
DROP POLICY "anyone" ON realtime.messages;
CREATE POLICY "own topic" ON realtime.messages FOR SELECT TO authenticated USING (topic = auth.uid()::text);
SELECT pg_temp.check(NOT pg_temp.has_gap('realtime_broadcast_open', 'realtime.messages%'), 'a rule with a real condition is fine');
DROP POLICY "own topic" ON realtime.messages;
ALTER PUBLICATION supabase_realtime DROP TABLE public.agent_integrations;
SELECT 'realtime_checks_test: all checks passed' AS result;
