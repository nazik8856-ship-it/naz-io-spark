-- Data encryption, front 4: what visitors type into a generated website's forms (and their IP address), and the live data read
-- from connected accounts (Gmail, Slack, Shopify…), are stored encrypted by the edge functions (DATA_KEY, _shared/encrypted-db.ts),
-- the same way as Outer Control content (20261103010000). No SQL reads these columns.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('website_form_submissions', 'fields'), ('website_form_submissions', 'submitter_ip'),
    ('integration_snapshots', 'data')
  ) AS v(t, c) LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text', r.t, r.c || '_enc');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    INSERT INTO public.encrypted_columns (table_name, column_name, note)
    VALUES (r.t, r.c, 'Encrypted with DATA_KEY (encrypted-db.ts).')
    ON CONFLICT (table_name, column_name) DO NOTHING;
  END LOOP;
END $$;

-- A plain write clears the older encrypted value (field_encryption_plain_wins, from 20261103010000).
DROP TRIGGER IF EXISTS website_form_submissions_plain_wins ON public.website_form_submissions;
CREATE TRIGGER website_form_submissions_plain_wins BEFORE INSERT OR UPDATE ON public.website_form_submissions FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('fields', 'submitter_ip');
DROP TRIGGER IF EXISTS integration_snapshots_plain_wins ON public.integration_snapshots;
CREATE TRIGGER integration_snapshots_plain_wins BEFORE INSERT OR UPDATE ON public.integration_snapshots FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('data');
