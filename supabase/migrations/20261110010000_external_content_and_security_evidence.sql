-- General data security, tasks 5 and 6 (docs/external-content.md, docs/security-evidence.md).
--
-- Task 5, unsafe external content: an agent run that outside text tried to steer records its refused or held-for-approval actions
-- with their own decision source, "external_content", so they are told apart and never teach a rule or a knowledge-base draft.
--
-- Task 6, security evidence for critical actions: an append-only, per-account chain of signed rows. Each row holds ids and hashes
-- only (never content): what kind of action, who, on what, the SHA-256 of what went in and came out, the rules applied, the verdict.
-- Rows are written only by record_evidence() (server only), each linked to the one before it and signed with a key kept in the vault.
-- Nothing can change or remove a row; verify_evidence_chain() recomputes every hash, link and signature, and the weekly check opens a
-- platform incident on any mismatch, gap or missing row.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Task 5: the new decision source (the live list, plus external_content).
ALTER TABLE public.agent_decisions DROP CONSTRAINT IF EXISTS agent_decisions_source_check;
ALTER TABLE public.agent_decisions
  ADD CONSTRAINT agent_decisions_source_check
  CHECK (source = ANY (ARRAY[
    'model', 'human_override', 'kill_switch', 'ai_spend_cap', 'agent_kill_switch',
    'agent_ai_spend_cap', 'hard_rule', 'circuit_breaker', 'circuit_breaker_trip',
    'safety_scanner', 'anomaly_detector', 'gate_error', 'gate_error_fail_open',
    'external_api', 'platform_kill_switch', 'platform_kill_switch_flip',
    'kill_switch_flip', 'consequential_sweeps_paused_flip', 'control_engine_unreachable',
    'external_content'
  ]::text[]));

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Task 6: the evidence table.

-- A subject names what an action touched by id: every value is a short scalar (no text bodies, no nested objects).
CREATE OR REPLACE FUNCTION public.evidence_subject_ok(s jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_typeof(s) = 'object' AND length(s::text) <= 1000 AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(s) e
    WHERE length(e.key) > 40
       OR jsonb_typeof(e.value) NOT IN ('string', 'number', 'boolean', 'null')
       OR (jsonb_typeof(e.value) = 'string' AND length(e.value #>> '{}') > 120)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.evidence_rule_ids_ok(ids text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT cardinality(ids) <= 50 AND NOT EXISTS (SELECT 1 FROM unnest(ids) i WHERE i !~ '^[A-Za-z0-9_:.-]{1,80}$');
$fn$;

CREATE TABLE IF NOT EXISTS public.security_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  seq bigint NOT NULL CHECK (seq >= 1),
  kind text NOT NULL CHECK (kind IN ('connector_call', 'credential_change', 'rule_applied', 'output_stored', 'content_held', 'outbound_blocked')),
  actor text NOT NULL CHECK (actor IN ('user', 'api_key', 'agent', 'system')),
  actor_id text CHECK (actor_id IS NULL OR actor_id ~ '^[A-Za-z0-9_:.-]{1,100}$'),
  subject jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.evidence_subject_ok(subject)),
  input_sha256 text CHECK (input_sha256 IS NULL OR input_sha256 ~ '^[0-9a-f]{64}$'),
  output_sha256 text CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'),
  rule_ids text[] NOT NULL DEFAULT '{}' CHECK (public.evidence_rule_ids_ok(rule_ids)),
  rules_sha256 text CHECK (rules_sha256 IS NULL OR rules_sha256 ~ '^[0-9a-f]{64}$'),
  verdict text NOT NULL CHECK (verdict ~ '^[a-z_]{1,40}$'),
  created_at timestamptz NOT NULL,
  prev_hash text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash text NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  signature text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$'),
  UNIQUE (user_id, seq)
);
CREATE INDEX IF NOT EXISTS security_evidence_kind_idx ON public.security_evidence (user_id, kind, created_at DESC);

-- The last row of each account's chain, kept by record_evidence(): a chain cut short at its end is still noticed.
CREATE TABLE IF NOT EXISTS public.security_evidence_heads (
  user_id uuid PRIMARY KEY,
  seq bigint NOT NULL,
  row_hash text NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_evidence_heads ENABLE ROW LEVEL SECURITY;
-- Nobody writes these tables directly, the server included: only record_evidence() (owned by the database owner) inserts.
REVOKE ALL ON public.security_evidence FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.security_evidence_heads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.security_evidence TO authenticated, service_role;
GRANT SELECT ON public.security_evidence_heads TO service_role;
DROP POLICY IF EXISTS security_evidence_owner_read ON public.security_evidence;
CREATE POLICY security_evidence_owner_read ON public.security_evidence FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note) VALUES
('security_evidence', 'owner', 'user_id', NULL, 'signed, append-only evidence of critical actions; the owner can read and export it (docs/security-evidence.md)'),
('security_evidence_heads', 'system_only', NULL, NULL, 'the last row of each account''s evidence chain (docs/security-evidence.md)')
ON CONFLICT (table_name) DO NOTHING;

DROP TRIGGER IF EXISTS prevent_owner_change ON public.security_evidence;
CREATE TRIGGER prevent_owner_change BEFORE UPDATE OF user_id ON public.security_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_change('user_id');

-- Rows can not be changed or removed. The one exception: the rows of an account that no longer exists (account deletion).
CREATE OR REPLACE FUNCTION public.security_evidence_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'security evidence is append-only: % is refused', lower(TG_OP) USING ERRCODE = '42501';
END $fn$;
REVOKE ALL ON FUNCTION public.security_evidence_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS security_evidence_append_only ON public.security_evidence;
CREATE TRIGGER security_evidence_append_only BEFORE UPDATE OR DELETE ON public.security_evidence
  FOR EACH ROW EXECUTE FUNCTION public.security_evidence_append_only();
DROP TRIGGER IF EXISTS security_evidence_no_truncate ON public.security_evidence;
CREATE TRIGGER security_evidence_no_truncate BEFORE TRUNCATE ON public.security_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.security_evidence_append_only();
DROP TRIGGER IF EXISTS security_evidence_heads_append_only ON public.security_evidence_heads;
DROP TRIGGER IF EXISTS security_evidence_heads_no_truncate ON public.security_evidence_heads;
CREATE TRIGGER security_evidence_heads_no_truncate BEFORE TRUNCATE ON public.security_evidence_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.security_evidence_append_only();

-- The signing key: 32 random bytes made inside the database, kept in the vault, never shown.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'security_evidence_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'security_evidence_key',
      'Signs security evidence rows (docs/security-evidence.md). Never rotate by editing: see the doc.');
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Writing a row.

CREATE OR REPLACE FUNCTION public.evidence_genesis(_user_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions, pg_temp AS $fn$
  SELECT encode(extensions.digest('nazai security evidence v1 genesis ' || _user_id::text, 'sha256'), 'hex');
$fn$;

-- The exact bytes a row's hash is taken over. jsonb prints its keys in one fixed order, so the subject is canonical too.
CREATE OR REPLACE FUNCTION public.evidence_canonical(
  _user_id uuid, _seq bigint, _kind text, _actor text, _actor_id text, _subject jsonb, _input text, _output text,
  _rule_ids text[], _rules_sha text, _verdict text, _at timestamptz, _prev text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT concat_ws(E'\n', 'nazai security evidence v1', _user_id::text, _seq::text, _kind, _actor, coalesce(_actor_id, ''),
    _subject::text, coalesce(_input, ''), coalesce(_output, ''), array_to_string(_rule_ids, ','), coalesce(_rules_sha, ''), _verdict,
    to_char(_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), _prev);
$fn$;

CREATE OR REPLACE FUNCTION public.record_evidence(
  _user_id uuid, _kind text, _actor text, _actor_id text DEFAULT NULL, _subject jsonb DEFAULT '{}'::jsonb,
  _input_sha256 text DEFAULT NULL, _output_sha256 text DEFAULT NULL, _rule_ids text[] DEFAULT '{}', _rules_sha256 text DEFAULT NULL,
  _verdict text DEFAULT 'recorded')
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE k text; last_seq bigint; last_hash text; nseq bigint; prev text; at timestamptz; h text; rid bigint;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'security evidence needs an account'; END IF;
  -- One writer per account at a time, so the chain never forks.
  PERFORM pg_advisory_xact_lock(hashtextextended('security_evidence:' || _user_id::text, 0));
  SELECT e.seq, e.row_hash INTO last_seq, last_hash FROM public.security_evidence e WHERE e.user_id = _user_id ORDER BY e.seq DESC LIMIT 1;
  nseq := coalesce(last_seq, 0) + 1;
  prev := coalesce(last_hash, public.evidence_genesis(_user_id));
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'security_evidence_key';
  IF k IS NULL OR length(k) < 32 THEN RAISE EXCEPTION 'the security evidence key is missing'; END IF;
  at := clock_timestamp();
  h := encode(extensions.digest(public.evidence_canonical(_user_id, nseq, _kind, _actor, _actor_id, coalesce(_subject, '{}'::jsonb),
    _input_sha256, _output_sha256, coalesce(_rule_ids, '{}'), _rules_sha256, _verdict, at, prev), 'sha256'), 'hex');
  INSERT INTO public.security_evidence (user_id, seq, kind, actor, actor_id, subject, input_sha256, output_sha256, rule_ids, rules_sha256,
    verdict, created_at, prev_hash, row_hash, signature)
  VALUES (_user_id, nseq, _kind, _actor, _actor_id, coalesce(_subject, '{}'::jsonb), _input_sha256, _output_sha256, coalesce(_rule_ids, '{}'),
    _rules_sha256, _verdict, at, prev, h, encode(extensions.hmac(h, k, 'sha256'), 'hex'))
  RETURNING id INTO rid;
  INSERT INTO public.security_evidence_heads (user_id, seq, row_hash, updated_at) VALUES (_user_id, nseq, h, at)
  ON CONFLICT (user_id) DO UPDATE SET seq = EXCLUDED.seq, row_hash = EXCLUDED.row_hash, updated_at = EXCLUDED.updated_at;
  RETURN rid;
END $fn$;
REVOKE ALL ON FUNCTION public.record_evidence(uuid, text, text, text, jsonb, text, text, text[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_evidence(uuid, text, text, text, jsonb, text, text, text[], text, text) TO service_role;
REVOKE ALL ON FUNCTION public.evidence_canonical(uuid, bigint, text, text, text, jsonb, text, text, text[], text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evidence_genesis(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. Verifying the chain: every hash, link and signature is recomputed; gaps and a missing end are named.
CREATE OR REPLACE FUNCTION public.verify_evidence_chain(_user_id uuid DEFAULT NULL, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(user_id uuid, seq bigint, problem text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE k text; r record; prev_seq bigint; prev_hash text; cur_user uuid; h text; first_in_range boolean;
BEGIN
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'security_evidence_key';
  IF k IS NULL THEN user_id := _user_id; seq := NULL; problem := 'key_missing'; RETURN NEXT; RETURN; END IF;
  cur_user := NULL;
  FOR r IN
    SELECT e.* FROM public.security_evidence e
    WHERE (_user_id IS NULL OR e.user_id = _user_id)
      AND (_from IS NULL OR e.created_at >= _from) AND (_to IS NULL OR e.created_at <= _to)
    ORDER BY e.user_id, e.seq
  LOOP
    IF cur_user IS DISTINCT FROM r.user_id THEN
      cur_user := r.user_id;
      -- The link into the range: the row before the first one checked (or the start of the chain).
      IF r.seq = 1 THEN prev_seq := 0; prev_hash := public.evidence_genesis(r.user_id);
      ELSE
        SELECT e.seq, e.row_hash INTO prev_seq, prev_hash FROM public.security_evidence e WHERE e.user_id = r.user_id AND e.seq = r.seq - 1;
        IF prev_seq IS NULL THEN user_id := r.user_id; seq := r.seq; problem := 'gap'; RETURN NEXT; prev_seq := r.seq - 1; prev_hash := r.prev_hash; END IF;
      END IF;
    END IF;
    IF r.seq <> prev_seq + 1 THEN user_id := r.user_id; seq := r.seq; problem := 'gap'; RETURN NEXT; END IF;
    IF r.prev_hash <> prev_hash THEN user_id := r.user_id; seq := r.seq; problem := 'broken_link'; RETURN NEXT; END IF;
    h := encode(extensions.digest(public.evidence_canonical(r.user_id, r.seq, r.kind, r.actor, r.actor_id, r.subject, r.input_sha256,
      r.output_sha256, r.rule_ids, r.rules_sha256, r.verdict, r.created_at, r.prev_hash), 'sha256'), 'hex');
    IF h <> r.row_hash THEN user_id := r.user_id; seq := r.seq; problem := 'hash_mismatch'; RETURN NEXT; END IF;
    IF encode(extensions.hmac(r.row_hash, k, 'sha256'), 'hex') <> r.signature THEN user_id := r.user_id; seq := r.seq; problem := 'signature_mismatch'; RETURN NEXT; END IF;
    prev_seq := r.seq; prev_hash := r.row_hash;
  END LOOP;
  -- A chain whose last rows were removed: the head names a row that is not there (only checked over a whole chain).
  IF _from IS NULL AND _to IS NULL THEN
    FOR r IN
      SELECT hd.user_id AS uid, hd.seq AS hseq, hd.row_hash AS hhash, (SELECT max(e.seq) FROM public.security_evidence e WHERE e.user_id = hd.user_id) AS mx,
        (SELECT e.row_hash FROM public.security_evidence e WHERE e.user_id = hd.user_id AND e.seq = hd.seq) AS at_head
      FROM public.security_evidence_heads hd WHERE _user_id IS NULL OR hd.user_id = _user_id
    LOOP
      IF r.mx IS DISTINCT FROM r.hseq OR r.at_head IS DISTINCT FROM r.hhash THEN
        user_id := r.uid; seq := r.hseq; problem := 'missing_rows'; RETURN NEXT;
      END IF;
    END LOOP;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.verify_evidence_chain(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_evidence_chain(uuid, timestamptz, timestamptz) TO service_role;

-- The owner's own chain, checked: whether every row of it is intact (no content is returned).
CREATE OR REPLACE FUNCTION public.my_evidence_check()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object(
    'rows', (SELECT count(*) FROM public.security_evidence e WHERE e.user_id = auth.uid()),
    'problems', coalesce((SELECT jsonb_agg(jsonb_build_object('seq', v.seq, 'problem', v.problem)) FROM public.verify_evidence_chain(auth.uid()) v), '[]'::jsonb),
    'checked_at', now())
  WHERE auth.uid() IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.my_evidence_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_evidence_check() TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Credential changes are recorded by the database itself, from any path: a credential can not change without its evidence
--    (if the row can not be written, the change fails with it).
CREATE OR REPLACE FUNCTION public.evidence_credential_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE col text; changed text[] := '{}'; o jsonb; n jsonb; owner uuid; rid text; uid uuid;
BEGIN
  o := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  n := CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (o -> col) IS DISTINCT FROM (n -> col) AND coalesce(o ->> col, n ->> col) IS NOT NULL THEN changed := changed || col; END IF;
  END LOOP;
  IF cardinality(changed) = 0 THEN RETURN NULL; END IF;
  owner := coalesce((n ->> 'user_id')::uuid, (o ->> 'user_id')::uuid);
  IF owner IS NULL THEN RETURN NULL; END IF;
  rid := coalesce(n ->> 'id', o ->> 'id');
  uid := auth.uid();
  PERFORM public.record_evidence(owner, 'credential_change', CASE WHEN uid IS NOT NULL THEN 'user' ELSE 'system' END, uid::text,
    jsonb_build_object('table', TG_TABLE_NAME, 'row', rid, 'columns', array_to_string(changed, ','), 'op', lower(TG_OP)),
    NULL, NULL, '{}', NULL, lower(TG_OP));
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.evidence_credential_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS external_tools_credential_evidence ON public.external_tools;
CREATE TRIGGER external_tools_credential_evidence AFTER INSERT OR UPDATE OF credentials_secret_id OR DELETE ON public.external_tools
  FOR EACH ROW EXECUTE FUNCTION public.evidence_credential_change('credentials_secret_id');
DROP TRIGGER IF EXISTS agent_integrations_credential_evidence ON public.agent_integrations;
CREATE TRIGGER agent_integrations_credential_evidence AFTER INSERT OR UPDATE OF credentials_secret_id, status OR DELETE ON public.agent_integrations
  FOR EACH ROW EXECUTE FUNCTION public.evidence_credential_change('credentials_secret_id', 'status');
DROP TRIGGER IF EXISTS agents_credential_evidence ON public.agents;
CREATE TRIGGER agents_credential_evidence AFTER INSERT OR UPDATE OF webhook_secret_id OR DELETE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.evidence_credential_change('webhook_secret_id');
DROP TRIGGER IF EXISTS api_keys_credential_evidence ON public.api_keys;
CREATE TRIGGER api_keys_credential_evidence AFTER INSERT OR UPDATE OF key_hash, revoked_at, callback_secret_id OR DELETE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.evidence_credential_change('key_hash', 'revoked_at', 'callback_secret_id');
DROP TRIGGER IF EXISTS webhooks_credential_evidence ON public.webhooks;
CREATE TRIGGER webhooks_credential_evidence AFTER INSERT OR UPDATE OF secret_id, previous_secret_id OR DELETE ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.evidence_credential_change('secret_id', 'previous_secret_id');

-- ---------------------------------------------------------------------------------------------------------------------------
-- 6. The weekly check: an open platform incident while any chain fails verification; the rows of deleted accounts are removed.
CREATE OR REPLACE FUNCTION public.security_evidence_weekly_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE problems jsonb; open_id uuid; result jsonb; purged int; kinds jsonb;
BEGIN
  DELETE FROM public.security_evidence e WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.user_id);
  GET DIAGNOSTICS purged = ROW_COUNT;
  DELETE FROM public.security_evidence_heads h WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = h.user_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', v.user_id, 'seq', v.seq, 'problem', v.problem)), '[]') INTO problems
    FROM public.verify_evidence_chain() v;
  SELECT coalesce(jsonb_object_agg(kind, n), '{}') INTO kinds
    FROM (SELECT e.kind, count(*) AS n FROM public.security_evidence e WHERE e.created_at > now() - interval '7 days' GROUP BY e.kind) x;
  result := jsonb_build_object('problems', problems, 'rows_last_7_days', kinds, 'purged_deleted_accounts', purged, 'checked_at', now());
  SELECT id INTO open_id FROM public.platform_incidents WHERE kind = 'security_evidence' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF jsonb_array_length(problems) > 0 THEN
    IF open_id IS NULL THEN
      INSERT INTO public.platform_incidents (kind, summary, detail) VALUES ('security_evidence',
        format('Security evidence check: %s problem(s). A row was changed, removed or signed with another key (docs/security-evidence.md).', jsonb_array_length(problems)), result);
    ELSE
      UPDATE public.platform_incidents SET detail = result WHERE id = open_id;
    END IF;
  ELSIF open_id IS NOT NULL THEN
    UPDATE public.platform_incidents SET resolved_at = now(), resolution_note = 'Every evidence chain verifies: hashes, links and signatures intact.' WHERE id = open_id;
  END IF;
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.security_evidence_weekly_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_evidence_weekly_check() TO service_role;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.schedule('security-evidence-weekly-check', '41 4 * * 1', 'SELECT public.security_evidence_weekly_check()');
END $$;

-- The new columns get their class (the register in data-classes.ts lists the same). Evidence holds ids and hashes only.
INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('security_evidence', 'actor', 'OPERATIONAL'),
('security_evidence', 'actor_id', 'OPERATIONAL'),
('security_evidence', 'input_sha256', 'OPERATIONAL'),
('security_evidence', 'kind', 'OPERATIONAL'),
('security_evidence', 'output_sha256', 'OPERATIONAL'),
('security_evidence', 'prev_hash', 'OPERATIONAL'),
('security_evidence', 'row_hash', 'OPERATIONAL'),
('security_evidence', 'rule_ids', 'OPERATIONAL'),
('security_evidence', 'rules_sha256', 'OPERATIONAL'),
('security_evidence', 'signature', 'OPERATIONAL'),
('security_evidence', 'subject', 'OPERATIONAL'),
('security_evidence', 'verdict', 'OPERATIONAL'),
('security_evidence_heads', 'row_hash', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;
