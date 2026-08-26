-- "Zero human review" plan, item 5: a safety-net sweep so nothing on an
-- auto-resolve-configured API key's decisions waits forever on a human
-- review that isn't coming. Items 1/2's per-key policy and item 4's live
-- callback both resolve a "needs a second look" outcome the moment it's
-- first created -- neither covers a row that's ALREADY stuck (a decision
-- from before a policy was set, a callback request that crashed before
-- its own bounded wait ever ran, or any other edge case).
--
-- pending_approval_events.event_type currently only allows 'assigned' and
-- 'escalated' (20260821040000_wave5_session3_approval_delegation.sql:35)
-- -- extended here, not introduced fresh, same "extend the existing
-- CHECK constraint" convention this project has used every time a new
-- event/source value needs to be written by code
-- (agent_decisions_source_check's own extension history; this exact
-- round's own api_keys_on_uncertain_check across items 1/3/4).
ALTER TABLE public.pending_approval_events
  DROP CONSTRAINT IF EXISTS pending_approval_events_event_type_check;

ALTER TABLE public.pending_approval_events
  ADD CONSTRAINT pending_approval_events_event_type_check
    CHECK (event_type IN ('assigned', 'escalated', 'auto_resolved'));

-- ============================================================
-- POST-MIGRATION STEP (same convention as approval-escalation-sweep in
-- 20260818031500_approval_escalation.sql -- applied directly, not
-- committed as static SQL, since it needs a project-specific service_role
-- key and function URL):
--
-- CRON JOB (pg_cron): schedule 'stuck-approval-sweep-15min' every 15
-- minutes -- matches STUCK_APPROVAL_MAX_WAIT_MINUTES
-- (_shared/api-key-policy.ts) so a stuck row is never left waiting
-- meaningfully longer than that threshold itself -- reusing the existing
-- 'email_queue_service_role_key' vault secret as the Authorization
-- bearer token:
--
--    SELECT cron.schedule(
--      'stuck-approval-sweep-15min',
--      '*/15 * * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/stuck-approval-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
--    To revert: SELECT cron.unschedule('stuck-approval-sweep-15min');
-- ============================================================
