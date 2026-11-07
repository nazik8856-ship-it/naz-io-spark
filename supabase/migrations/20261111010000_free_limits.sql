-- Free usage limits (docs/onboarding-windows.md).
--
-- A free (Explorer) account may start 3 Control Tasks and create 2 new websites per calendar month (UTC). Everything already made
-- stays available; only the new limited action is refused, with a calm reason the app shows in its limit window.
--   - A Task that failed, was cancelled, stopped or rejected does not count.
--   - Accounts whose email is in free_limit_exempt_emails have no limits.
-- free_limit_status() is what the server checks before it starts work; the insert triggers are the backstop for any other path.

CREATE TABLE IF NOT EXISTS public.free_limit_exempt_emails (
  email text PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+$'),
  note text
);
ALTER TABLE public.free_limit_exempt_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_limit_exempt_emails FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.free_limit_exempt_emails TO service_role;
INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
VALUES ('free_limit_exempt_emails', 'system_only', NULL, NULL, 'accounts with no free usage limits (docs/onboarding-windows.md)')
ON CONFLICT (table_name) DO NOTHING;
INSERT INTO public.free_limit_exempt_emails (email, note) VALUES ('nazik8856@gmail.com', 'owner account')
ON CONFLICT (email) DO NOTHING;

-- The limits, in one place (the app reads them back from free_limit_status / my_free_limits).
CREATE OR REPLACE FUNCTION public.free_limit_of(_kind text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT CASE _kind WHEN 'control_task' THEN 3 WHEN 'website' THEN 2 END;
$fn$;

-- Whether this account is limited and how much of this month's free allowance it has used.
CREATE OR REPLACE FUNCTION public.free_limit_status(_user_id uuid, _kind text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE lim int := public.free_limit_of(_kind); month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  used int := 0; tier text; exempt boolean;
BEGIN
  IF lim IS NULL OR _user_id IS NULL THEN RETURN jsonb_build_object('kind', _kind, 'limited', false); END IF;
  SELECT p.tier INTO tier FROM public.profiles p WHERE p.id = _user_id;
  SELECT EXISTS (SELECT 1 FROM auth.users u JOIN public.free_limit_exempt_emails x ON x.email = lower(u.email) WHERE u.id = _user_id) INTO exempt;
  IF exempt OR coalesce(tier, 'explorer') <> 'explorer' THEN
    RETURN jsonb_build_object('kind', _kind, 'limited', false, 'limit', lim);
  END IF;
  IF _kind = 'control_task' THEN
    SELECT count(*) INTO used FROM public.outer_control_workflows w
      WHERE w.user_id = _user_id AND w.started_at >= month_start AND w.status NOT IN ('failed', 'cancelled', 'stopped', 'rejected', 'skipped');
  ELSIF _kind = 'website' THEN
    SELECT count(*) INTO used FROM public.websites s WHERE s.user_id = _user_id AND s.created_at >= month_start;
  END IF;
  RETURN jsonb_build_object('kind', _kind, 'limited', true, 'used', used, 'limit', lim, 'allowed', used < lim,
    'resets_at', (month_start AT TIME ZONE 'UTC' + interval '1 month') AT TIME ZONE 'UTC');
END $fn$;
REVOKE ALL ON FUNCTION public.free_limit_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_limit_status(uuid, text) TO service_role;

-- The signed-in person's own usage, for the limit window's "View usage".
CREATE OR REPLACE FUNCTION public.my_free_limits()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object('control_task', public.free_limit_status(auth.uid(), 'control_task'), 'website', public.free_limit_status(auth.uid(), 'website'))
  WHERE auth.uid() IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.my_free_limits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_free_limits() TO authenticated, service_role;

-- The backstop: a new Task or website past the free limit is refused from any path (the app checks first and explains).
CREATE OR REPLACE FUNCTION public.enforce_free_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE st jsonb;
BEGIN
  -- One check at a time per account, so two starts at the same moment can not both take the last free slot.
  PERFORM pg_advisory_xact_lock(hashtextextended('free_limit:' || TG_ARGV[0] || ':' || NEW.user_id::text, 0));
  st := public.free_limit_status(NEW.user_id, TG_ARGV[0]);
  IF (st ->> 'limited')::boolean AND NOT (st ->> 'allowed')::boolean THEN
    RAISE EXCEPTION 'free_limit:%', TG_ARGV[0] USING ERRCODE = 'P0001', DETAIL = st::text;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.enforce_free_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS outer_control_workflows_free_limit ON public.outer_control_workflows;
CREATE TRIGGER outer_control_workflows_free_limit BEFORE INSERT ON public.outer_control_workflows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_limit('control_task');
DROP TRIGGER IF EXISTS websites_free_limit ON public.websites;
CREATE TRIGGER websites_free_limit BEFORE INSERT ON public.websites
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_limit('website');

INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('free_limit_exempt_emails', 'email', 'PERSONAL'),
('free_limit_exempt_emails', 'note', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;
INSERT INTO public.encryption_exempt_columns (table_name, column_name, reason, kind) VALUES
('free_limit_exempt_emails', 'email', 'address matched against the account email to lift the free limits; system only, never shown', 'by_design')
ON CONFLICT (table_name, column_name) DO NOTHING;
