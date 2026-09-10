-- "Sweep safety & observability" front, items 2 and 4.
--
-- Item 4: the existing platform-wide kill switch (platform_settings.kill_switch,
-- checked by control-gate.ts before every decision) does NOT reach the 3
-- consequential sweep functions (control-api-abuse-sweep, outcome-quality-sweep,
-- stuck-approval-sweep) at all -- they are independent pg_cron-triggered edge
-- functions that never call control-gate.ts and never read platform_settings.
-- Verified by reading their own source: none of the three checks any kill
-- switch before pausing a key, downgrading a policy, or auto-resolving an
-- approval. A genuine "these 3 sweeps are doing something wrong, stop them
-- NOW" situation had no dedicated lever -- only editing the cron schedule
-- itself (removing the ability to see WHY they were stopped, or resume
-- cleanly). Mirrors platform_settings' own kill_switch columns exactly.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS consequential_sweeps_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consequential_sweeps_paused_reason text,
  ADD COLUMN IF NOT EXISTS consequential_sweeps_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS consequential_sweeps_paused_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Item 2 (blast-radius attribution): on_uncertain_downgrade_reason today is
-- only a free-text sentence (policy-downgrade.ts's summarizePolicyDowngrade)
-- -- there's no machine-readable way to tell "downgraded because of repeated
-- abuse pauses" (control-api-abuse-sweep) apart from "downgraded because of
-- bad real-world outcomes" (outcome-quality-sweep) without fragile substring
-- matching on that sentence. This is the exact same DowngradeReason type
-- policy-downgrade.ts already defines, just persisted structurally.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS on_uncertain_downgrade_kind text
    CHECK (on_uncertain_downgrade_kind IS NULL OR on_uncertain_downgrade_kind IN ('repeated_pause', 'callback_failures', 'bad_outcomes'));

-- Item 1 + 2: a real "sweep activity" dashboard needs (a) last-run status for
-- every sweep-shaped cron job, and (b) 24h blast-radius counts for the 3
-- consequential sweeps specifically. Both are platform-wide, cross-account
-- data -- same audience (admin/owner) as platform_incidents/
-- scheduled_job_requests, so both RPCs use the identical has_role() gate
-- those tables' own RLS policies already use, and are granted directly to
-- `authenticated` (unlike get_job_health_outcomes, which is service-role-only
-- because cron-health-check calls it internally) so the dashboard page can
-- call them straight from the browser with the viewer's own JWT.

-- cron.job_run_details is pg_cron's own native run log (covers all 27 jobs,
-- not just the 6 wired into scheduled_job_requests) -- it only proves the
-- SQL command executed without error, not that the target function returned
-- 2xx (see cron-health-check's own doc comment on that exact gap). Honest
-- about that distinction in the column naming rather than implying more
-- confidence than this signal actually has.
CREATE OR REPLACE FUNCTION public.get_sweep_job_last_runs()
RETURNS TABLE(job_name text, last_run_at timestamptz, last_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (j.jobname)
    j.jobname AS job_name,
    d.start_time AS last_run_at,
    d.status AS last_status
  FROM cron.job j
  LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid
  WHERE j.jobname LIKE '%sweep%'
  ORDER BY j.jobname, d.start_time DESC NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sweep_job_last_runs() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_sweep_job_last_runs() TO authenticated;

-- Real, response-verified blast-radius counts for the 3 consequential
-- sweeps specifically -- these mutate account state (pause a key, downgrade
-- a policy, auto-resolve an approval), so they get a stronger signal than
-- the "did the cron command run" check above.
CREATE OR REPLACE FUNCTION public.get_consequential_sweep_activity(_since timestamptz)
RETURNS TABLE(
  keys_paused bigint,
  keys_downgraded_abuse bigint,
  keys_downgraded_outcome bigint,
  approvals_auto_resolved bigint,
  coordinated_abuse_flagged bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY SELECT
    (SELECT count(*) FROM public.api_keys WHERE last_pause_at >= _since),
    (SELECT count(*) FROM public.api_keys WHERE on_uncertain_downgraded_at >= _since AND on_uncertain_downgrade_kind = 'repeated_pause'),
    (SELECT count(*) FROM public.api_keys WHERE on_uncertain_downgraded_at >= _since AND on_uncertain_downgrade_kind = 'bad_outcomes'),
    (SELECT count(*) FROM public.pending_approval_events WHERE event_type = 'auto_resolved' AND created_at >= _since),
    (SELECT count(*) FROM public.profiles WHERE coordinated_abuse_alerted_at >= _since);
END;
$$;
REVOKE ALL ON FUNCTION public.get_consequential_sweep_activity(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_consequential_sweep_activity(timestamptz) TO authenticated;
