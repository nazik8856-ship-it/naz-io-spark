-- Data retention: agent_decisions and agent_events grow unbounded today
-- with no purge path. A per-account retention_days setting (default 400,
-- floor of 30 so nobody accidentally wipes everything) + a scheduled sweep
-- that deletes rows older than the window.
ALTER TABLE public.profiles
  ADD COLUMN retention_days integer NOT NULL DEFAULT 400 CHECK (retention_days >= 30);

-- Extend the existing settings-change-log trigger to also cover retention_days.
CREATE OR REPLACE FUNCTION public.log_profile_config_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.control_strictness IS DISTINCT FROM OLD.control_strictness
     OR NEW.kill_switch IS DISTINCT FROM OLD.kill_switch
     OR NEW.retention_days IS DISTINCT FROM OLD.retention_days THEN
    INSERT INTO public.config_changes (user_id, actor_id, table_name, row_id, action, before, after)
    VALUES (
      NEW.id, auth.uid(), 'profiles', NEW.id, 'update',
      jsonb_build_object('control_strictness', OLD.control_strictness, 'kill_switch', OLD.kill_switch, 'retention_days', OLD.retention_days),
      jsonb_build_object('control_strictness', NEW.control_strictness, 'kill_switch', NEW.kill_switch, 'retention_days', NEW.retention_days)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- POST-MIGRATION STEP (same convention as prior scheduled jobs this
-- session — applied directly, not committed as static SQL):
--
-- CRON JOB (pg_cron): schedule 'retention-sweep-daily' at 03:00 UTC,
-- reusing the existing 'email_queue_service_role_key' vault secret:
--
--    SELECT cron.schedule(
--      'retention-sweep-daily',
--      '0 3 * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/retention-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
--    To revert: SELECT cron.unschedule('retention-sweep-daily');
-- ============================================================
