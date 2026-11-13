-- Account erasure, order of deletion (docs/account-erasure.md). A first live run (rolled back) showed that letting the login's cascade
-- remove the owner tables fires the change-log triggers for rows of a user who is being deleted, which fails. So every registered owner
-- table is now emptied explicitly first (the change log last), and only then is the login removed.
CREATE OR REPLACE FUNCTION public.erase_account(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault, pg_temp AS $fn$
DECLARE
  email_addr text; counts jsonb := '{}'::jsonb; n bigint; t record; passes int := 0; progress boolean; remaining text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT lower(u.email) INTO email_addr FROM auth.users u WHERE u.id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such account' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role::text IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'platform staff accounts are not erased here' USING ERRCODE = '42501';
  END IF;

  -- 1. Every registered owner table, explicitly. Children may block parents: repeat until nothing is left or nothing moves. The change log
  --    (config_changes) goes last because deleting the other tables writes to it; the signed security record goes after the login.
  DROP TABLE IF EXISTS _erase_todo;
  CREATE TEMP TABLE _erase_todo ON COMMIT DROP AS
    SELECT p.table_name, p.owner_column FROM public.erasure_plan() p
     WHERE p.table_name NOT IN ('security_evidence', 'config_changes');
  LOOP
    passes := passes + 1; progress := false;
    FOR t IN SELECT * FROM _erase_todo LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', t.table_name, t.owner_column) USING _user_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        counts := counts || jsonb_build_object(t.table_name, n);
        DELETE FROM _erase_todo WHERE table_name = t.table_name;
        progress := true;
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM _erase_todo) OR NOT progress OR passes >= 6;
  END LOOP;
  SELECT string_agg(table_name, ', ') INTO remaining FROM _erase_todo;
  IF remaining IS NOT NULL THEN RAISE EXCEPTION 'could not erase: %', remaining; END IF;

  -- 2. The person as a member of other accounts, and invitations sent to their address.
  DELETE FROM public.account_members WHERE member_id = _user_id OR (email_addr IS NOT NULL AND lower(email) = email_addr);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('account_members_elsewhere', n);

  -- 3. Rows kept by address: mail log and unsubscribe links. (The suppression list stays: it is how an opt-out is honoured.)
  IF email_addr IS NOT NULL THEN
    DELETE FROM public.email_send_log WHERE lower(recipient_email) = email_addr;
    GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('email_send_log', n);
    DELETE FROM public.email_unsubscribe_tokens WHERE lower(email) = email_addr;
    DELETE FROM public.free_limit_exempt_emails WHERE lower(email) = email_addr;
  END IF;

  -- 4. Stored secrets that belong to the person.
  DELETE FROM vault.secrets WHERE id IN (SELECT secret_id FROM public.vault_secret_owners WHERE user_id = _user_id);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('vault_secrets', n);
  DELETE FROM public.vault_secret_owners WHERE user_id = _user_id;

  -- 5. The change log, now that nothing writes to it any more.
  DELETE FROM public.config_changes WHERE user_id = _user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('config_changes', n);

  -- 6. The login (sessions, factors and recovery codes go with it).
  DELETE FROM auth.users WHERE id = _user_id;

  -- 7. The signed security record: its rows can be removed only once the account no longer exists.
  DELETE FROM public.security_evidence WHERE user_id = _user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('security_evidence', n);
  DELETE FROM public.security_evidence_heads WHERE user_id = _user_id;

  -- 8. Prove it: nothing may be left in any registered owner table.
  FOR t IN SELECT * FROM public.erasure_plan() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', t.table_name, t.owner_column) INTO n USING _user_id;
    IF n > 0 THEN RAISE EXCEPTION 'rows left in %: %', t.table_name, n; END IF;
  END LOOP;

  INSERT INTO public.account_erasures (user_hash, counts) VALUES (encode(extensions.digest(_user_id::text, 'sha256'), 'hex'), counts);
  RETURN counts;
END $fn$;
