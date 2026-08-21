-- Self-service data export/delete: distinct from the automatic
-- retention/purge job (which quietly ages out old agent_decisions/
-- agent_events on a rolling window) -- this is a manual, GDPR-style
-- "delete my account's control-system data" request, the kind of ask
-- professional B2B SaaS gets from day one. A grace period (7 days,
-- cancellable) rather than instant irreversible deletion on a single
-- click, matching how real SaaS (GitHub account deletion, Stripe, etc.)
-- handle this.
CREATE TABLE public.data_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  execute_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  cancelled_at timestamptz,
  completed_at timestamptz
);

-- Only one active (pending) request per account at a time.
CREATE UNIQUE INDEX idx_data_deletion_requests_one_pending
  ON public.data_deletion_requests (user_id) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE ON public.data_deletion_requests TO authenticated;
GRANT ALL ON public.data_deletion_requests TO service_role;

ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Only the account owner themselves -- not a team owner, not global
-- admin/owner staff roles -- can request or cancel deletion of their own
-- account's data. This is deliberately narrower than every other
-- per-agent/per-account policy table this session, which all allow team-
-- owner writes: destroying data is a different risk class from managing
-- guardrails, and shouldn't be delegable to an invited teammate.
CREATE POLICY "Only the account owner can view their own deletion requests"
ON public.data_deletion_requests FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Only the account owner can request their own data deletion"
ON public.data_deletion_requests FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND auth.uid() = requested_by);

CREATE POLICY "Only the account owner can cancel their own pending deletion"
ON public.data_deletion_requests FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RPC: request deletion (7-day grace period). Idempotent -- calling this
-- again while a request is already pending just returns the existing one
-- rather than erroring or creating a second row (the partial unique index
-- above would reject a second pending row anyway).
CREATE OR REPLACE FUNCTION public.request_data_deletion()
RETURNS public.data_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  existing public.data_deletion_requests;
  created public.data_deletion_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO existing FROM public.data_deletion_requests WHERE user_id = uid AND status = 'pending';
  IF existing.id IS NOT NULL THEN RETURN existing; END IF;

  INSERT INTO public.data_deletion_requests (user_id, requested_by, execute_at)
  VALUES (uid, uid, now() + interval '7 days')
  RETURNING * INTO created;
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.request_data_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_data_deletion() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_data_deletion(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  updated_count int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.data_deletion_requests
     SET status = 'cancelled', cancelled_at = now()
   WHERE id = _request_id AND user_id = uid AND status = 'pending';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_data_deletion(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_data_deletion(uuid) TO authenticated;

-- Daily sweep (pg_cron): executes any request whose grace period has
-- elapsed. Mirrors the existing retention-sweep-daily job's cadence.
SELECT cron.schedule(
  'data-deletion-sweep-daily',
  '0 5 * * *',
  $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'data-deletion-sweep-daily', net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/data-deletion-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
