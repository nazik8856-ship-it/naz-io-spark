-- User & data isolation, front 5: the two-user check on the LIVE database. Read the file, then run it as is (SQL editor or the Supabase tool).
--
-- It uses real rows and real people and CHANGES NOTHING: everything happens inside one statement that always ends in an error, so the
-- database rolls the whole thing back (the "error" at the end is the report). For every registered owner / team / self table that has
-- rows it takes the account with the most rows as A, another real person as a stranger (B) and a third as a team viewer of A (V,
-- added to A's team inside the rolled-back statement), and asks:
--   B  reads A's rows? changes them? gives them to themself? deletes them? creates a row for A?
--   V  changes? gives away? deletes? creates?          A (control)  reads their own rows?
-- A "yes" to any question for B or V is a leak. Tables without rows are listed (nothing to test there yet). Run it after every change
-- to a table, a rule or a function, and before a release. Needs at least 3 real users.
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

DO $$
DECLARE
  t record; people uuid[]; A uuid; B uuid; V uuid; fq text; oc text; r integer; cnt bigint;
  rowjson jsonb; clone_sql text; has_id boolean;
  leaks text[] := '{}'; empty text[] := '{}'; tested integer := 0; asked integer := 0; controls integer := 0; no_control text[] := '{}';
  q record;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO people FROM auth.users;
  IF coalesce(array_length(people, 1), 0) < 3 THEN RAISE EXCEPTION 'needs at least 3 real users'; END IF;

  FOR t IN
    SELECT i.table_name, i.owner_column, i.access FROM public.isolation_tables i
    WHERE i.access IN ('owner', 'team', 'self') AND i.owner_column IS NOT NULL ORDER BY 1
  LOOP
    IF to_regclass(format('public.%I', t.table_name)) IS NULL OR NOT EXISTS (
         SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(format('public.%I', t.table_name)) AND a.attname = t.owner_column AND NOT a.attisdropped) THEN CONTINUE; END IF;
    fq := format('public.%I', t.table_name); oc := quote_ident(t.owner_column);
    -- A: the account with the most rows
    EXECUTE format('SELECT %s, count(*) FROM %s WHERE %s IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 1', oc, fq, oc) INTO A, cnt;
    IF A IS NULL THEN empty := empty || t.table_name; CONTINUE; END IF;
    -- B and V: two other real people (V is made a viewer of A's team)
    SELECT p INTO B FROM unnest(people) p WHERE p <> A ORDER BY p LIMIT 1;
    SELECT p INTO V FROM unnest(people) p WHERE p <> A AND p <> B ORDER BY p LIMIT 1;
    DELETE FROM public.account_members WHERE account_owner_id = A AND member_id IN (B, V);
    INSERT INTO public.account_members (account_owner_id, member_id, email, role, status) VALUES (A, V, 'viewer@check.invalid', 'viewer', 'active');
    -- a copy of one of A's rows to try to create as someone else
    EXECUTE format('SELECT to_jsonb(r) FROM %s r WHERE %s = %L LIMIT 1', fq, oc, A) INTO rowjson;
    has_id := rowjson ? 'id' AND jsonb_typeof(rowjson -> 'id') = 'string' AND (rowjson ->> 'id') ~ '^[0-9a-f-]{36}$';
    IF has_id THEN rowjson := rowjson || jsonb_build_object('id', gen_random_uuid()); END IF;
    clone_sql := format('INSERT INTO %s SELECT * FROM jsonb_populate_record(null::%s, %L::jsonb)', fq, fq, rowjson::text);
    tested := tested + 1;

    r := pg_temp.as_person(A, format('SELECT count(*) FROM %s WHERE %s = %L', fq, oc, A));
    IF r >= 1 THEN controls := controls + 1; ELSE no_control := no_control || t.table_name; END IF;

    FOR q IN SELECT * FROM (VALUES
      ('B', B, 'reads A''s rows',               format('SELECT count(*) FROM %s WHERE %s = %L', fq, oc, A)),
      ('B', B, 'changes A''s rows',             format('WITH u AS (UPDATE %s SET %s = %s WHERE %s = %L RETURNING 1) SELECT count(*) FROM u', fq, oc, oc, oc, A)),
      ('B', B, 'gives A''s rows to themself',   format('WITH u AS (UPDATE %s SET %s = %L WHERE %s = %L RETURNING 1) SELECT count(*) FROM u', fq, oc, B, oc, A)),
      ('B', B, 'deletes A''s rows',             format('WITH d AS (DELETE FROM %s WHERE %s = %L RETURNING 1) SELECT count(*) FROM d', fq, oc, A)),
      ('B', B, 'creates a row for A',           format('WITH i AS (%s RETURNING 1) SELECT count(*) FROM i', clone_sql)),
      ('V', V, 'changes A''s rows',             format('WITH u AS (UPDATE %s SET %s = %s WHERE %s = %L RETURNING 1) SELECT count(*) FROM u', fq, oc, oc, oc, A)),
      ('V', V, 'gives A''s rows to themself',   format('WITH u AS (UPDATE %s SET %s = %L WHERE %s = %L RETURNING 1) SELECT count(*) FROM u', fq, oc, V, oc, A)),
      ('V', V, 'deletes A''s rows',             format('WITH d AS (DELETE FROM %s WHERE %s = %L RETURNING 1) SELECT count(*) FROM d', fq, oc, A)),
      ('V', V, 'creates a row for A',           format('WITH i AS (%s RETURNING 1) SELECT count(*) FROM i', clone_sql))
    ) AS x(who, person, question, sql) LOOP
      r := pg_temp.as_person(q.person, q.sql); asked := asked + 1;
      IF r > 0 THEN leaks := leaks || format('%s: %s %s (%s)', t.table_name, CASE q.who WHEN 'B' THEN 'a stranger' ELSE 'a team viewer' END, q.question, r); END IF;
    END LOOP;
  END LOOP;

  -- always ends in an error: nothing above is kept
  RAISE EXCEPTION E'TWO-USER CHECK (nothing was changed)\ntables tested: %\nquestions asked: %\nLEAKS: %\n%\nowner could read own rows in: % of % tables\nowner could not read own rows in: %\ntables with no rows yet: %',
    tested, asked, coalesce(array_length(leaks, 1), 0), coalesce(array_to_string(leaks, E'\n'), '(none)'), controls, tested, coalesce(array_to_string(no_control, ', '), '(none)'), coalesce(array_to_string(empty, ', '), '(none)');
END $$;
