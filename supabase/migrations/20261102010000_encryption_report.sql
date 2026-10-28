-- Data encryption, front 2: the bookkeeping for encrypting user content column by column (no content table changes here).
--
-- The pattern, for each column NazAI encrypts itself (docs/data-encryption.md):
--   1. an "<col>_enc" column is added next to "<col>";
--   2. the server writes the encrypted value to "<col>_enc" and empties "<col>"; readers prefer "<col>_enc", fall back to "<col>";
--   3. the sweep (field-crypto.ts sweepColumn) converts existing rows, 50 per run;
--   4. encryption_report() shows how many plain values are left; at 0, encryption_enforce() adds a check that "<col>" stays empty.
--
-- encrypted_columns lists those columns. Imported project text (imported_projects.content, encrypted with PROJECTS_KEY since
-- before this front) is listed from the start, so the report is useful today.

CREATE TABLE IF NOT EXISTS public.encrypted_columns (
  table_name text NOT NULL,
  column_name text NOT NULL,
  -- What an emptied plain column holds: null, or '' for a column that can not be null.
  plain_empty text NOT NULL DEFAULT 'null' CHECK (plain_empty IN ('null', 'empty_text')),
  note text,
  added_at timestamptz NOT NULL DEFAULT now(),
  enforced_at timestamptz,
  PRIMARY KEY (table_name, column_name)
);
ALTER TABLE public.encrypted_columns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.encrypted_columns FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.encrypted_columns TO service_role;

INSERT INTO public.encrypted_columns (table_name, column_name, plain_empty, note)
VALUES ('imported_projects', 'content', 'empty_text', 'Project text; encrypted with PROJECTS_KEY (project-crypto.ts).')
ON CONFLICT (table_name, column_name) DO NOTHING;

-- Per listed column: plain values left, encrypted values, how many are on each key (the key id in "v2:<key id>:..."), and
-- whether the plain column is locked empty. A table that does not exist (yet) is reported with nulls instead of failing.
CREATE OR REPLACE FUNCTION public.encryption_report()
RETURNS TABLE (table_name text, column_name text, plain_rows bigint, encrypted_rows bigint, keys jsonb, enforced boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c record; empty_cond text;
BEGIN
  FOR c IN SELECT * FROM public.encrypted_columns ORDER BY 1, 2 LOOP
    table_name := c.table_name; column_name := c.column_name; enforced := c.enforced_at IS NOT NULL;
    plain_rows := NULL; encrypted_rows := NULL; keys := NULL;
    IF to_regclass(format('public.%I', c.table_name)) IS NOT NULL THEN
      empty_cond := CASE c.plain_empty WHEN 'empty_text' THEN format(' AND %I::text <> %L', c.column_name, '') ELSE '' END;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL', c.table_name, c.column_name) || empty_cond INTO plain_rows;
      EXECUTE format('SELECT coalesce(sum(n), 0), coalesce(jsonb_object_agg(k, n), %L::jsonb) FROM (SELECT split_part(%I, %L, 2) AS k, count(*) AS n FROM public.%I WHERE %I IS NOT NULL GROUP BY 1) s',
        '{}', c.column_name || '_enc', ':', c.table_name, c.column_name || '_enc') INTO encrypted_rows, keys;
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.encryption_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encryption_report() TO service_role;

-- Locks a fully converted column: refuses while any plain value is left, then adds "<table>_<column>_encrypted" CHECK that the
-- plain column stays empty, so no later code path can store the text in the clear again.
CREATE OR REPLACE FUNCTION public.encryption_enforce(p_table text, p_column text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.encrypted_columns; left_rows bigint; cname text; cond text;
BEGIN
  SELECT * INTO c FROM public.encrypted_columns WHERE table_name = p_table AND column_name = p_column;
  IF NOT FOUND THEN RAISE EXCEPTION '%.% is not listed in encrypted_columns', p_table, p_column; END IF;
  SELECT r.plain_rows INTO left_rows FROM public.encryption_report() r WHERE r.table_name = p_table AND r.column_name = p_column;
  IF left_rows IS NULL THEN RAISE EXCEPTION 'table % does not exist', p_table; END IF;
  IF left_rows > 0 THEN RAISE EXCEPTION '%.% still has % plain values; run the sweep first', p_table, p_column, left_rows; END IF;
  cname := left(p_table || '_' || p_column || '_encrypted', 63);
  cond := CASE c.plain_empty WHEN 'empty_text' THEN format('%I IS NULL OR %I::text = %L', p_column, p_column, '') ELSE format('%I IS NULL', p_column) END;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID', p_table, cname, cond);
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', p_table, cname);
  END IF;
  UPDATE public.encrypted_columns SET enforced_at = coalesce(enforced_at, now()) WHERE table_name = p_table AND column_name = p_column;
END $$;
REVOKE ALL ON FUNCTION public.encryption_enforce(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encryption_enforce(text, text) TO service_role;
