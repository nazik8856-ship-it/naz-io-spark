-- Clean it (Context Day 1): pasted text from any AI comes back as one result that follows the account's rules and context.
-- A free (Explorer) account gets 15 cleaned results a day (UTC); paid use comes later. The same exemptions as every free limit:
-- a paid tier, or an address on free_limit_exempt_emails. A clean is counted by its first check, which the reply review records
-- with source_model 'paste:<source>' (the re-check of a rewrite is 'paste-recheck:<source>' and is not counted). The server
-- checks free_limit_status before it spends anything (control-system-decide, action clean_text).
-- FREE_CLEANS_PER_DAY in supabase/functions/_shared/context-clean.ts holds the same number (a test compares them).

CREATE OR REPLACE FUNCTION public.free_limit_of(_kind text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT CASE _kind WHEN 'control_task' THEN 3 WHEN 'website' THEN 2 WHEN 'context_clean' THEN 15 END;
$fn$;

CREATE OR REPLACE FUNCTION public.free_limit_status(_user_id uuid, _kind text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE lim int := public.free_limit_of(_kind); month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
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
  ELSIF _kind = 'context_clean' THEN
    SELECT count(*) INTO used FROM public.outer_control_evaluations e
      WHERE e.user_id = _user_id AND e.created_at >= day_start AND e.source_model LIKE 'paste:%';
    RETURN jsonb_build_object('kind', _kind, 'limited', true, 'used', used, 'limit', lim, 'allowed', used < lim, 'period', 'day',
      'resets_at', (day_start AT TIME ZONE 'UTC' + interval '1 day') AT TIME ZONE 'UTC');
  END IF;
  RETURN jsonb_build_object('kind', _kind, 'limited', true, 'used', used, 'limit', lim, 'allowed', used < lim,
    'resets_at', (month_start AT TIME ZONE 'UTC' + interval '1 month') AT TIME ZONE 'UTC');
END $fn$;
REVOKE ALL ON FUNCTION public.free_limit_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_limit_status(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.my_free_limits()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object('control_task', public.free_limit_status(auth.uid(), 'control_task'), 'website', public.free_limit_status(auth.uid(), 'website'),
    'context_clean', public.free_limit_status(auth.uid(), 'context_clean'))
  WHERE auth.uid() IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.my_free_limits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_free_limits() TO authenticated, service_role;
