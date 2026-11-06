-- General data security, task 4: cross-platform boundary control (docs/cross-platform-boundary.md).
--
-- Outer Control moves an account's content between NazAI and the tools that account connected. Everything a Task or a step
-- points at (its tool, its fallback tool, its Task, its API key, its imported project, the agent behind an agent tool, the step
-- a memory or a check belongs to) must belong to the same account as the row that points at it. Until now the code checked
-- that on the way in; from here the database refuses any write that breaks it, from any path, the server's included.
--
-- A vault secret (a tool's key, an integration's tokens, a signing secret) belongs to the account that first stored a
-- reference to it. A row of any other account that points at it is refused, so a credential can never be borrowed across
-- accounts by copying its id.
--
-- boundary_report() lists any row that crosses accounts and any reference without its check; boundary_weekly_check() opens the
-- platform incident cross_platform_boundary while it has anything.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. References that must stay inside one account.

CREATE TABLE IF NOT EXISTS public.boundary_references (
  table_name text NOT NULL,
  column_name text NOT NULL,
  ref_table text NOT NULL,
  note text,
  PRIMARY KEY (table_name, column_name)
);
ALTER TABLE public.boundary_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.boundary_references FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.boundary_references TO service_role;
INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
VALUES ('boundary_references', 'system_only', NULL, NULL, 'references that must stay inside one account (docs/cross-platform-boundary.md)')
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO public.boundary_references (table_name, column_name, ref_table, note) VALUES
('outer_control_sessions', 'tool_id', 'external_tools', 'the tool a step calls'),
('outer_control_sessions', 'fallback_tool_id', 'external_tools', 'the tool a step falls back to'),
('outer_control_sessions', 'workflow_id', 'outer_control_workflows', 'the Task a step belongs to'),
('outer_control_sessions', 'api_key_id', 'api_keys', 'the key a step was started with'),
('outer_control_workflows', 'project_id', 'imported_projects', 'the project a Task works with'),
('outer_control_workflows', 'api_key_id', 'api_keys', 'the key a Task was started with'),
('external_tools', 'agent_id', 'agents', 'the agent behind an agent tool'),
('outer_control_session_steps', 'session_id', 'outer_control_sessions', 'the step a call belongs to'),
('outer_control_memory', 'session_id', 'outer_control_sessions', 'the step a memory came from'),
('outer_control_memory', 'workflow_id', 'outer_control_workflows', 'the Task a memory belongs to'),
('outer_control_completion_checks', 'session_id', 'outer_control_sessions', 'the step a completion check belongs to'),
('outer_control_corrections', 'session_id', 'outer_control_sessions', 'the step a correction belongs to'),
('outer_control_task_handoffs', 'task_id', 'outer_control_workflows', 'the Task a hand-off belongs to'),
('project_rules', 'project_id', 'imported_projects', 'the project a rule belongs to'),
('meaning_rules', 'project_id', 'imported_projects', 'the project a meaning rule belongs to')
ON CONFLICT (table_name, column_name) DO UPDATE SET ref_table = EXCLUDED.ref_table, note = EXCLUDED.note;

-- The trigger: each named column (TG_ARGV, in pairs: column, referenced table) must point at a row of the same account, or at
-- nothing. A referenced row that does not exist (any more) is not a crossing.
CREATE OR REPLACE FUNCTION public.enforce_same_account()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE i integer := 0; col text; ref text; target uuid; owner uuid; hit boolean; j jsonb := to_jsonb(NEW);
BEGIN
  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i]; ref := TG_ARGV[i + 1]; i := i + 2;
    IF (j ->> col) IS NULL THEN CONTINUE; END IF;
    target := (j ->> col)::uuid;
    EXECUTE format('SELECT user_id, true FROM public.%I WHERE id = $1', ref) INTO owner, hit USING target;
    IF hit AND owner IS DISTINCT FROM (j ->> 'user_id')::uuid THEN
      RAISE EXCEPTION '%.% points at a % row of another account', TG_TABLE_NAME, col, ref
        USING ERRCODE = '42501', HINT = 'Outer Control keeps every Task, step, tool and project inside one account (docs/cross-platform-boundary.md).';
    END IF;
  END LOOP;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.enforce_same_account() FROM PUBLIC, anon, authenticated;

-- One trigger per table, over all of its registered references (also when the row's own account column changes).
DO $$
DECLARE r record; args text; cols text;
BEGIN
  FOR r IN SELECT b.table_name, array_agg(b.column_name ORDER BY b.column_name) AS cs, array_agg(b.ref_table ORDER BY b.column_name) AS rs
             FROM public.boundary_references b WHERE to_regclass(format('public.%I', b.table_name)) IS NOT NULL GROUP BY b.table_name LOOP
    SELECT string_agg(format('%L, %L', r.cs[k], r.rs[k]), ', '), string_agg(quote_ident(r.cs[k]), ', ')
      INTO args, cols FROM generate_subscripts(r.cs, 1) AS k;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.table_name || '_same_account', r.table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %s, user_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_same_account(%s)',
      r.table_name || '_same_account', cols, r.table_name, args);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. A vault secret belongs to one account.

CREATE TABLE IF NOT EXISTS public.vault_secret_owners (
  secret_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  first_table text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vault_secret_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vault_secret_owners FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.vault_secret_owners TO service_role;
INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
VALUES ('vault_secret_owners', 'system_only', NULL, NULL, 'which account each vault secret belongs to (docs/cross-platform-boundary.md)')
ON CONFLICT (table_name) DO NOTHING;

-- The columns that hold a vault secret's id: the first account to point at a secret owns it; any other account is refused.
CREATE OR REPLACE FUNCTION public.claim_vault_secret()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE col text; sid uuid; owner uuid; j jsonb := to_jsonb(NEW); me uuid := (to_jsonb(NEW) ->> 'user_id')::uuid;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (j ->> col) IS NULL THEN CONTINUE; END IF;
    sid := (j ->> col)::uuid;
    INSERT INTO public.vault_secret_owners (secret_id, user_id, first_table) VALUES (sid, me, TG_TABLE_NAME) ON CONFLICT (secret_id) DO NOTHING;
    SELECT o.user_id INTO owner FROM public.vault_secret_owners o WHERE o.secret_id = sid;
    IF owner IS DISTINCT FROM me THEN
      RAISE EXCEPTION '%.% points at a vault secret of another account', TG_TABLE_NAME, col
        USING ERRCODE = '42501', HINT = 'A credential belongs to the account that stored it (docs/cross-platform-boundary.md).';
    END IF;
  END LOOP;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.claim_vault_secret() FROM PUBLIC, anon, authenticated;

-- Who owns each secret today (no secret is referenced by two accounts on the live project; boundary_report() would show one).
INSERT INTO public.vault_secret_owners (secret_id, user_id, first_table)
SELECT DISTINCT ON (sid) sid, uid, t FROM (
  SELECT credentials_secret_id AS sid, user_id AS uid, 'external_tools' AS t FROM public.external_tools WHERE credentials_secret_id IS NOT NULL
  UNION ALL SELECT credentials_secret_id, user_id, 'agent_integrations' FROM public.agent_integrations WHERE credentials_secret_id IS NOT NULL
  UNION ALL SELECT webhook_secret_id, user_id, 'agents' FROM public.agents WHERE webhook_secret_id IS NOT NULL
  UNION ALL SELECT callback_secret_id, user_id, 'api_keys' FROM public.api_keys WHERE callback_secret_id IS NOT NULL
  UNION ALL SELECT secret_id, user_id, 'webhooks' FROM public.webhooks WHERE secret_id IS NOT NULL
  UNION ALL SELECT previous_secret_id, user_id, 'webhooks' FROM public.webhooks WHERE previous_secret_id IS NOT NULL
) x ORDER BY sid, t
ON CONFLICT (secret_id) DO NOTHING;

DROP TRIGGER IF EXISTS external_tools_vault_owner ON public.external_tools;
CREATE TRIGGER external_tools_vault_owner BEFORE INSERT OR UPDATE OF credentials_secret_id, user_id ON public.external_tools
  FOR EACH ROW EXECUTE FUNCTION public.claim_vault_secret('credentials_secret_id');
DROP TRIGGER IF EXISTS agent_integrations_vault_owner ON public.agent_integrations;
CREATE TRIGGER agent_integrations_vault_owner BEFORE INSERT OR UPDATE OF credentials_secret_id, user_id ON public.agent_integrations
  FOR EACH ROW EXECUTE FUNCTION public.claim_vault_secret('credentials_secret_id');
DROP TRIGGER IF EXISTS agents_vault_owner ON public.agents;
CREATE TRIGGER agents_vault_owner BEFORE INSERT OR UPDATE OF webhook_secret_id, user_id ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.claim_vault_secret('webhook_secret_id');
DROP TRIGGER IF EXISTS api_keys_vault_owner ON public.api_keys;
CREATE TRIGGER api_keys_vault_owner BEFORE INSERT OR UPDATE OF callback_secret_id, user_id ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.claim_vault_secret('callback_secret_id');
DROP TRIGGER IF EXISTS webhooks_vault_owner ON public.webhooks;
CREATE TRIGGER webhooks_vault_owner BEFORE INSERT OR UPDATE OF secret_id, previous_secret_id, user_id ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.claim_vault_secret('secret_id', 'previous_secret_id');

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. The check.

CREATE OR REPLACE FUNCTION public.boundary_report()
RETURNS TABLE (problem text, table_name text, column_name text, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT * FROM public.boundary_references b ORDER BY 1, 2 LOOP
    table_name := r.table_name; column_name := r.column_name;
    IF to_regclass(format('public.%I', r.table_name)) IS NULL OR to_regclass(format('public.%I', r.ref_table)) IS NULL THEN
      problem := 'stale'; detail := 'registered but the table no longer exists'; RETURN NEXT; CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass(format('public.%I', r.table_name)) AND g.tgname = r.table_name || '_same_account' AND NOT g.tgisinternal) THEN
      problem := 'unenforced'; detail := format('no %s_same_account trigger', r.table_name); RETURN NEXT;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I x JOIN public.%I y ON y.id = x.%I WHERE y.user_id IS DISTINCT FROM x.user_id', r.table_name, r.ref_table, r.column_name) INTO n;
    IF n > 0 THEN problem := 'crosses_accounts'; detail := format('%s row(s) point at a %s row of another account', n, r.ref_table); RETURN NEXT; END IF;
  END LOOP;
  -- a vault secret pointed at by more than one account
  FOR r IN SELECT x.sid, count(DISTINCT x.uid) AS accounts FROM (
             SELECT credentials_secret_id AS sid, user_id AS uid FROM public.external_tools
             UNION ALL SELECT credentials_secret_id, user_id FROM public.agent_integrations
             UNION ALL SELECT webhook_secret_id, user_id FROM public.agents
             UNION ALL SELECT callback_secret_id, user_id FROM public.api_keys
             UNION ALL SELECT secret_id, user_id FROM public.webhooks
             UNION ALL SELECT previous_secret_id, user_id FROM public.webhooks) x
           WHERE x.sid IS NOT NULL GROUP BY x.sid HAVING count(DISTINCT x.uid) > 1 LOOP
    problem := 'secret_shared'; table_name := 'vault'; column_name := NULL; detail := format('a vault secret is referenced by %s accounts', r.accounts);
    RETURN NEXT;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.boundary_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boundary_report() TO service_role;

CREATE OR REPLACE FUNCTION public.boundary_weekly_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE problems jsonb; open_id uuid; result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') INTO problems FROM public.boundary_report() r;
  result := jsonb_build_object('problems', problems, 'checked_at', now());
  SELECT id INTO open_id FROM public.platform_incidents WHERE kind = 'cross_platform_boundary' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF jsonb_array_length(problems) > 0 THEN
    IF open_id IS NULL THEN
      INSERT INTO public.platform_incidents (kind, summary, detail) VALUES ('cross_platform_boundary',
        format('Cross-platform boundary check: %s problem(s). A Task, step, tool, project or credential points across accounts, or a '
          || 'reference lost its check (docs/cross-platform-boundary.md).', jsonb_array_length(problems)), result);
    ELSE
      UPDATE public.platform_incidents SET detail = result WHERE id = open_id;
    END IF;
  ELSIF open_id IS NOT NULL THEN
    UPDATE public.platform_incidents SET resolved_at = now(), resolution_note = 'Every reference stays inside its account; every vault secret has one owner.' WHERE id = open_id;
  END IF;
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.boundary_weekly_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boundary_weekly_check() TO service_role;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.schedule('boundary-weekly-check', '53 3 * * 1', 'SELECT public.boundary_weekly_check()');
END $$;

-- The new columns get their class (the register in data-classes.ts lists the same).
INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('boundary_references', 'column_name', 'OPERATIONAL'),
('boundary_references', 'note', 'OPERATIONAL'),
('boundary_references', 'ref_table', 'OPERATIONAL'),
('boundary_references', 'table_name', 'OPERATIONAL'),
('vault_secret_owners', 'first_table', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;
