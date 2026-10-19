-- Outer Control: what each tool is used for, and a credit back when a paid report does not get delivered.

-- 1. Usage per tool (requests actually sent, from the recorded exchanges). The view runs with the caller's rights, so row level
--    security applies: a person sees only their own tools and a team member the owner's.
CREATE OR REPLACE VIEW public.outer_control_tool_usage WITH (security_invoker = true) AS
SELECT
  s.user_id,
  s.tool_id,
  count(*) FILTER (WHERE st.created_at >= now() - interval '30 days') AS requests_30d,
  count(*) FILTER (WHERE st.created_at >= now() - interval '30 days' AND (st.error IS NOT NULL OR COALESCE(st.http_status, 200) >= 400)) AS failed_30d,
  count(*) FILTER (WHERE st.created_at >= date_trunc('day', now())) AS requests_today,
  max(st.created_at) AS last_request_at
FROM public.outer_control_session_steps st
JOIN public.outer_control_sessions s ON s.id = st.session_id
WHERE st.request IS NOT NULL
GROUP BY s.user_id, s.tool_id;
REVOKE ALL ON public.outer_control_tool_usage FROM PUBLIC, anon;
GRANT SELECT ON public.outer_control_tool_usage TO authenticated, service_role;

-- 2. A report costs one credit when it starts. If the Task ends without delivering it (failed or cancelled), the credit goes back,
--    once: the single conditional UPDATE below is what makes a second call do nothing.
ALTER TABLE public.outer_control_workflows
  ADD COLUMN IF NOT EXISTS credit_charged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_refunded_at timestamptz;

CREATE OR REPLACE FUNCTION public.refund_workflow_credit(p_workflow_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid;
BEGIN
  UPDATE public.outer_control_workflows
     SET credit_refunded_at = now()
   WHERE id = p_workflow_id
     AND credit_charged
     AND credit_refunded_at IS NULL
     AND status IN ('failed', 'cancelled')
  RETURNING user_id INTO uid;
  IF uid IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.profiles SET credits = credits + 1 WHERE id = uid;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.refund_workflow_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_workflow_credit(uuid) TO service_role;

-- A credit taken for something that could not even start goes straight back (service role only).
CREATE OR REPLACE FUNCTION public.refund_generation_credit(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.profiles SET credits = credits + 1 WHERE id = p_user_id;
$function$;
REVOKE ALL ON FUNCTION public.refund_generation_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_generation_credit(uuid) TO service_role;
