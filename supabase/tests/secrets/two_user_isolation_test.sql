-- User & data isolation, front 5: the same two-user check on EVERY registered table that exists.
--
-- For each table registered as owner / team / self (isolation_tables) a row owned by A is created (the server's way, by the superuser),
-- then asked of B (a stranger) and V (a viewer in A's team):
--   B  can not read A's row, can not change it, can not give it away (owner column), can not delete it, can not create a row for A
--   V  (a team viewer) can not change, give away, delete or create either
--   A  (the control) can read the row -- so "B saw nothing" is not just "nobody sees anything"
-- A table whose row could not be created generically (a check rule, an unsupported column type) is listed as skipped, never silently
-- passed; the run fails if too few tables were really tested, and on the first leak, naming the table and the question.
-- The same questions are asked of the live database by supabase/tests/live/two_user_check.sql.
\set ON_ERROR_STOP 1
RESET ROLE;

-- The membership check as it is live (the shared baseline's copy ignores the role and the permission).
CREATE OR REPLACE FUNCTION public.is_account_member(_account_owner_id uuid, _min_role text DEFAULT NULL, _permission text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE account_owner_id = _account_owner_id AND member_id = auth.uid() AND status = 'active'
      AND (_min_role IS NULL OR (_min_role = 'viewer') OR (_min_role = 'approver' AND role IN ('approver', 'owner')) OR (_min_role = 'owner' AND role = 'owner'))
      AND (_permission IS NULL OR permissions IS NULL OR _permission = ANY(permissions)))
$$;
TRUNCATE public.account_members;
INSERT INTO public.account_members (account_owner_id, member_id, email, role, status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c3', 'v@x.test', 'viewer', 'active');

-- The row for A in a table: column list and values as an INSERT statement, or the reason it can not be built.
CREATE OR REPLACE FUNCTION pg_temp.insert_for(_tbl regclass, _owner_col text, _owner uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c record; cols text[] := '{}'; vals text[] := '{}'; v text;
BEGIN
  FOR c IN
    SELECT a.attname, a.attnotnull, a.atthasdef, a.attidentity, format_type(a.atttypid, a.atttypmod) AS ft, t.typtype, a.atttypid
    FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = _tbl AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    ORDER BY a.attnum
  LOOP
    IF c.attname <> _owner_col AND NOT (c.attnotnull AND NOT c.atthasdef AND c.attidentity = '') THEN CONTINUE; END IF;
    v := CASE
      WHEN c.attname = _owner_col THEN quote_literal(_owner::text) || '::uuid'
      WHEN c.typtype = 'e' THEN quote_literal((SELECT enumlabel FROM pg_enum WHERE enumtypid = c.atttypid ORDER BY enumsortorder LIMIT 1)) || '::' || c.ft
      WHEN c.ft = 'uuid' THEN 'gen_random_uuid()'
      WHEN c.ft ~ '^(text|character|citext)' THEN quote_literal('x')
      WHEN c.ft ~ '^(smallint|integer|bigint|numeric|real|double precision)' THEN '0'
      WHEN c.ft = 'boolean' THEN 'false'
      WHEN c.ft IN ('json', 'jsonb') THEN quote_literal('{}') || '::' || c.ft
      WHEN c.ft ~ '^timestamp' THEN 'now()'
      WHEN c.ft = 'date' THEN 'current_date'
      WHEN c.ft ~ '\[\]$' THEN quote_literal('{}') || '::' || c.ft
      WHEN c.ft = 'bytea' THEN quote_literal('\x00') || '::bytea'
      ELSE NULL END;
    IF v IS NULL THEN RETURN 'unsupported column type ' || c.ft || ' (' || c.attname || ')'; END IF;
    cols := cols || quote_ident(c.attname); vals := vals || v;
  END LOOP;
  RETURN format('INSERT INTO %s (%s) VALUES (%s)', _tbl, array_to_string(cols, ', '), array_to_string(vals, ', '));
END $$;

-- Run a statement as a person; the number of rows it returned, or -1 when it was refused.
CREATE OR REPLACE FUNCTION pg_temp.as_person(_person uuid, _sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _person::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql INTO n;
  EXCEPTION WHEN OTHERS THEN
    n := -1;
  END;
  RESET ROLE;
  RETURN n;
END $$;

CREATE TEMP TABLE two_user_results (tbl text, question text, leaked boolean, detail text);
CREATE TEMP TABLE two_user_skipped (tbl text, why text);

DO $$
DECLARE
  A constant uuid := '00000000-0000-0000-0000-0000000000a1';
  B constant uuid := '00000000-0000-0000-0000-0000000000b2';
  V constant uuid := '00000000-0000-0000-0000-0000000000c3';
  t record; ins text; fq text; n integer; mine integer;
  tested integer := 0; controls integer := 0;
  dml text;
BEGIN
  FOR t IN
    SELECT i.table_name, i.owner_column, i.access, to_regclass(format('public.%I', i.table_name)) AS reloid
    FROM public.isolation_tables i
    WHERE i.access IN ('owner', 'team', 'self') AND i.owner_column IS NOT NULL
    ORDER BY i.table_name
  LOOP
    IF t.reloid IS NULL OR (SELECT relkind FROM pg_class WHERE oid = t.reloid) NOT IN ('r') THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = t.reloid AND attname = t.owner_column AND NOT attisdropped) THEN CONTINUE; END IF;
    fq := format('public.%I', t.table_name);

    -- build and create A's row, without foreign keys or triggers (the server writes rows its own way)
    ins := pg_temp.insert_for(t.reloid, t.owner_column, A);
    IF ins NOT LIKE 'INSERT INTO %' THEN INSERT INTO two_user_skipped VALUES (t.table_name, ins); CONTINUE; END IF;
    BEGIN
      PERFORM set_config('session_replication_role', 'replica', true);
      EXECUTE ins;
      PERFORM set_config('session_replication_role', 'origin', true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('session_replication_role', 'origin', true);
      INSERT INTO two_user_skipped VALUES (t.table_name, 'row could not be created: ' || SQLERRM);
      CONTINUE;
    END;
    tested := tested + 1;

    -- the control: the owner sees the row
    mine := pg_temp.as_person(A, format('SELECT count(*) FROM %s WHERE %I = %L', fq, t.owner_column, A));
    IF mine >= 1 THEN controls := controls + 1; END IF;
    INSERT INTO two_user_results VALUES (t.table_name, 'owner reads own row (control)', false, mine::text);

    -- B and V ask the same questions
    FOR n IN 1..2 LOOP
      DECLARE who uuid := CASE n WHEN 1 THEN B ELSE V END; label text := CASE n WHEN 1 THEN 'stranger' ELSE 'viewer' END; r integer;
      BEGIN
        IF n = 1 THEN
          r := pg_temp.as_person(who, format('SELECT count(*) FROM %s WHERE %I = %L', fq, t.owner_column, A));
          INSERT INTO two_user_results VALUES (t.table_name, label || ' reads A''s row', r > 0, r::text);
        END IF;
        r := pg_temp.as_person(who, format('WITH u AS (UPDATE %s SET %I = %I WHERE %I = %L RETURNING 1) SELECT count(*) FROM u', fq, t.owner_column, t.owner_column, t.owner_column, A));
        INSERT INTO two_user_results VALUES (t.table_name, label || ' changes A''s row', r > 0, r::text);
        r := pg_temp.as_person(who, format('WITH u AS (UPDATE %s SET %I = %L WHERE %I = %L RETURNING 1) SELECT count(*) FROM u', fq, t.owner_column, who, t.owner_column, A));
        INSERT INTO two_user_results VALUES (t.table_name, label || ' gives A''s row to themself', r > 0, r::text);
        r := pg_temp.as_person(who, format('WITH d AS (DELETE FROM %s WHERE %I = %L RETURNING 1) SELECT count(*) FROM d', fq, t.owner_column, A));
        INSERT INTO two_user_results VALUES (t.table_name, label || ' deletes A''s row', r > 0, r::text);
        r := pg_temp.as_person(who, format('WITH i AS (%s RETURNING 1) SELECT count(*) FROM i', ins));
        INSERT INTO two_user_results VALUES (t.table_name, label || ' creates a row for A', r > 0, r::text);
      END;
    END LOOP;
    -- clean up what a leak would have left, so the next table starts clean
  END LOOP;
  RAISE NOTICE 'two-user check: % tables tested, % skipped, owner could read own row in %', tested, (SELECT count(*) FROM two_user_skipped), controls;
END $$;

-- the report
SELECT 'tested' AS what, count(DISTINCT tbl) AS n FROM two_user_results
UNION ALL SELECT 'questions asked', count(*) FROM two_user_results
UNION ALL SELECT 'skipped', count(*) FROM two_user_skipped
UNION ALL SELECT 'leaks', count(*) FROM two_user_results WHERE leaked;
SELECT tbl, question, detail FROM two_user_results WHERE leaked ORDER BY 1, 2;
SELECT tbl, left(why, 90) AS why FROM two_user_skipped ORDER BY 1;
SELECT tbl AS owner_could_not_read_own_row FROM two_user_results WHERE question LIKE '%(control)' AND detail::int < 1 ORDER BY 1;

DO $$
DECLARE leaks text; tested integer;
BEGIN
  SELECT string_agg(tbl || ': ' || question || ' (' || detail || ')', E'\n') INTO leaks FROM two_user_results WHERE leaked;
  IF leaks IS NOT NULL THEN RAISE EXCEPTION E'FAILED: a person reached data that is not theirs:\n%', leaks; END IF;
  SELECT count(DISTINCT tbl) INTO tested FROM two_user_results;
  IF tested < 10 THEN RAISE EXCEPTION 'FAILED: only % tables could be tested; the check is not testing enough', tested; END IF;
END $$;
SELECT 'two_user_isolation_test: all checks passed' AS result;
