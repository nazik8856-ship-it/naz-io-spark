-- Release check: the security advisor lists 23 SECURITY DEFINER functions that visitors (anon) can call and 45 that signed-in people can.
-- Every one of them already checks who is calling inside its own body (auth.uid(), auth.role() = 'service_role', a role or membership
-- check), so a stranger gets an error, not data. This closes the door in front of the check as well, wherever nobody who is not the
-- server needs to knock:
--
--   SYSTEM ONLY (no visitor, no signed-in person; only the server's service role): called by edge functions with the service-role key,
--     or fired by a database trigger. A trigger function is checked for EXECUTE when the trigger is created, not when it fires, so
--     existing triggers keep working.
--       - the six OAuth "consume transaction" functions (the callback functions call them with the service-role key)
--       - eight trigger functions (guards, change log, signing)
--       - get_business_context, verify_decision_signature (called by edge functions with the service-role key)
--   SIGNED-IN ONLY (no visitor): the browser calls these as the signed-in person, so signed-in people keep them. They check the caller.
--       - read_webhook_secret, rotate_webhook_secret (both forms), record_approval_signoff, verify_decision_signatures_batch (4 arguments)
--
-- LEFT AS THEY ARE, on purpose (the advisor will keep listing them):
--   has_role, is_account_member, session_mfa_ok, can_access: row rules call them for whoever is asking, so the asking role needs EXECUTE.
--   get_public_site: a visitor opens a published site through it, by design.
--   the signed-in functions the app calls (add_project_time, request_policy_change, approvals, data deletion, ...): each one starts with
--     its own caller check; the browser needs them.
--
-- A function that does not exist (a differently named copy on another project) is skipped, not an error. To revert a function, GRANT
-- EXECUTE on it back to the role.

DO $$
DECLARE
  sig text;
  system_only text[] := ARRAY[
    'public.consume_canva_oauth_transaction(text)',
    'public.consume_figma_oauth_transaction(text)',
    'public.consume_gmail_oauth_transaction(text)',
    'public.consume_notion_oauth_transaction(text)',
    'public.consume_shopify_oauth_transaction(text)',
    'public.consume_slack_oauth_transaction(text)',
    'public.guard_decision_human_response()',
    'public.guard_kill_switch()',
    'public.guard_pending_approval_update()',
    'public.log_config_change()',
    'public.log_profile_config_change()',
    'public.set_account_member_invited_by()',
    'public.set_platform_incident_resolved_by()',
    'public.sign_agent_decision()',
    'public.get_business_context(uuid)',
    'public.verify_decision_signature(uuid)'
  ];
  signed_in_only text[] := ARRAY[
    'public.read_webhook_secret(uuid)',
    'public.rotate_webhook_secret(uuid)',
    'public.rotate_webhook_secret(uuid, text, integer)',
    'public.record_approval_signoff(uuid, text, text, text)',
    'public.verify_decision_signatures_batch(timestamptz, timestamptz, integer, uuid)'
  ];
BEGIN
  FOREACH sig IN ARRAY system_only LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
      IF has_function_privilege('anon', sig, 'EXECUTE') OR has_function_privilege('authenticated', sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'function access: % can still be executed by a visitor or a signed-in person', sig;
      END IF;
    END IF;
  END LOOP;
  FOREACH sig IN ARRAY signed_in_only LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', sig);
      IF has_function_privilege('anon', sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'function access: % can still be executed by a visitor', sig;
      END IF;
    END IF;
  END LOOP;
END $$;
