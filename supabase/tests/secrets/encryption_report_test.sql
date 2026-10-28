-- Data encryption, front 2: 20261102010000 lists the encrypted columns, reports the plain values left per column and per key, and
-- locks a fully converted column so its plain copy stays empty. Only the server (service_role) can use any of it.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails(stmt text, expect text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM ILIKE '%' || expect || '%'; END $$;

-- Before the table exists, its row is reported with nulls instead of failing.
DROP TABLE IF EXISTS public.imported_projects;
\ir ../../migrations/20261102010000_encryption_report.sql
\ir ../../migrations/20261102010000_encryption_report.sql
SELECT pg_temp.check((SELECT plain_rows IS NULL AND NOT enforced FROM public.encryption_report() WHERE table_name = 'imported_projects'), 'a missing table is reported, not an error');

CREATE TABLE public.imported_projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), content text NOT NULL DEFAULT '', content_enc text);
GRANT ALL ON public.imported_projects TO authenticated, service_role;
INSERT INTO public.imported_projects (content, content_enc) VALUES
  ('still plain', NULL), ('', 'v2:aaaa1111:iv:ct'), ('', 'v2:aaaa1111:iv:ct'), ('', 'v2:bbbb2222:iv:ct');
SELECT pg_temp.check((SELECT plain_rows = 1 AND encrypted_rows = 3 AND keys = '{"aaaa1111": 2, "bbbb2222": 1}'::jsonb FROM public.encryption_report() WHERE table_name = 'imported_projects'),
  'plain values left, encrypted values, and how many on each key');

SELECT pg_temp.check(pg_temp.fails($$SELECT public.encryption_enforce('imported_projects', 'content')$$, 'still has 1 plain values'), 'locking is refused while plain text is left');
SELECT pg_temp.check(pg_temp.fails($$SELECT public.encryption_enforce('profiles', 'user_context')$$, 'not listed'), 'only listed columns can be locked');
UPDATE public.imported_projects SET content = '', content_enc = 'v2:aaaa1111:iv:ct' WHERE content = 'still plain';
SELECT public.encryption_enforce('imported_projects', 'content');
SELECT public.encryption_enforce('imported_projects', 'content');
SELECT pg_temp.check((SELECT plain_rows = 0 AND enforced FROM public.encryption_report() WHERE table_name = 'imported_projects'), 'locked once nothing plain is left (and locking twice is fine)');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO public.imported_projects (content) VALUES ('plain again')$$, 'imported_projects_content_encrypted'), 'plain text can not be stored again');
INSERT INTO public.imported_projects (content, content_enc) VALUES ('', 'v2:aaaa1111:iv:ct');

-- A nullable column, emptied to null.
CREATE TABLE public.notes_t (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), body jsonb, body_enc text);
INSERT INTO public.encrypted_columns (table_name, column_name) VALUES ('notes_t', 'body');
INSERT INTO public.notes_t (body) VALUES ('{"a": 1}'), (NULL);
SELECT pg_temp.check((SELECT plain_rows = 1 AND encrypted_rows = 0 AND keys = '{}'::jsonb FROM public.encryption_report() WHERE table_name = 'notes_t'), 'a jsonb column counts its non-null values');
UPDATE public.notes_t SET body = NULL, body_enc = 'v2:aaaa1111:iv:ct' WHERE body IS NOT NULL;
SELECT public.encryption_enforce('notes_t', 'body');
SELECT pg_temp.check(pg_temp.fails($$INSERT INTO public.notes_t (body) VALUES ('{"b": 2}')$$, 'notes_t_body_encrypted'), 'a locked jsonb column stays null');

-- Nobody but the server.
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM public.encryption_report()$$, 'permission denied'), 'a signed-in user can not run the report');
SELECT pg_temp.check(pg_temp.fails($$SELECT public.encryption_enforce('notes_t', 'body')$$, 'permission denied'), 'nor lock a column');
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM public.encrypted_columns$$, 'permission denied'), 'nor read the list');
SET ROLE anon;
SELECT pg_temp.check(pg_temp.fails($$SELECT * FROM public.encryption_report()$$, 'permission denied'), 'nor can an anonymous visitor');
SET ROLE service_role;
SELECT pg_temp.check((SELECT count(*) = 2 FROM public.encryption_report()), 'the server can');
RESET ROLE;
DROP TABLE public.notes_t;
DELETE FROM public.encrypted_columns WHERE table_name = 'notes_t';
\echo 'encryption_report_test: all checks passed'
