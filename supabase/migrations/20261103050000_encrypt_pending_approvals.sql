-- Data encryption, front 4: what an approval request says (pending_approvals.description), the approver's comment (comment) and
-- what the executed action reported (execution_summary) are stored encrypted by the edge functions (DATA_KEY,
-- _shared/encrypted-db.ts), the same way as Outer Control content (20261103010000).
--
-- - The website reads them through outer-control-read; a sign-off with a comment goes through encrypted-write, which records
--   the vote with record_approval_signoff (comment null, so the plain column stays empty) and then stores the comment encrypted.
-- - execution_summary is scrubbed of secrets by the server before it is encrypted (the redact trigger only ever sees the empty
--   plain column now).
-- - Policy replay read the description through get_replayable_real_decisions. Its _v2 version also returns the approval row id
--   and the encrypted description, which the server decrypts.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('pending_approvals', 'description'), ('pending_approvals', 'comment'), ('pending_approvals', 'execution_summary')
  ) AS v(t, c) LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text', r.t, r.c || '_enc');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    INSERT INTO public.encrypted_columns (table_name, column_name, note)
    VALUES (r.t, r.c, 'Encrypted with DATA_KEY (encrypted-db.ts).')
    ON CONFLICT (table_name, column_name) DO NOTHING;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS pending_approvals_plain_wins ON public.pending_approvals;
CREATE TRIGGER pending_approvals_plain_wins BEFORE INSERT OR UPDATE ON public.pending_approvals FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('description', 'comment', 'execution_summary');

CREATE OR REPLACE FUNCTION public.get_replayable_real_decisions_v2(_user_id uuid, _limit integer DEFAULT 200)
RETURNS TABLE(id uuid, action_type text, provider text, description text, params jsonb, created_at timestamptz, real_source text,
              approval_row_id uuid, description_enc text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, action_type, provider, description, params, created_at, 'decision'::text AS real_source, NULL::uuid, NULL::text
  FROM public.agent_decisions
  WHERE user_id = _user_id AND params IS NOT NULL
  UNION ALL
  SELECT decision_id, action_type, provider, description, params, created_at, 'approval'::text AS real_source, id, description_enc
  FROM public.pending_approvals
  WHERE user_id = _user_id AND decision_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT greatest(1, least(_limit, 2000));
$$;
REVOKE ALL ON FUNCTION public.get_replayable_real_decisions_v2(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_replayable_real_decisions_v2(uuid, integer) TO service_role;
