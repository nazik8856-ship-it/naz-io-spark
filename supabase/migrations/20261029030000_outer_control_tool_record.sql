-- Outer Control: each tool's track record over the last 30 days, for the tool list and for suggesting tools when a Task is
-- started. Sessions: how many finished, failed (the tool did not answer usably) or were stopped by rules; replies: how many the
-- rules blocked, edited (cut something out) or sent for approval; speed: the median time to a finished session, not counting
-- time spent waiting for a person. Runs with the caller's rights, so row level security applies.
CREATE OR REPLACE VIEW public.outer_control_tool_record WITH (security_invoker = true) AS
WITH s AS (
  SELECT id, user_id, tool_id, status, started_at, finished_at, waited_ms
  FROM public.outer_control_sessions
  WHERE started_at >= now() - interval '30 days'
), v AS (
  SELECT st.session_id,
    count(*) FILTER (WHERE st.verdict IS NOT NULL) AS replies,
    count(*) FILTER (WHERE st.verdict = 'block') AS blocked,
    count(*) FILTER (WHERE st.verdict = 'modify') AS edited,
    count(*) FILTER (WHERE st.verdict = 'escalate') AS escalated
  FROM public.outer_control_session_steps st
  JOIN s ON s.id = st.session_id
  GROUP BY st.session_id
)
SELECT
  s.user_id,
  s.tool_id,
  count(*) AS sessions,
  count(*) FILTER (WHERE s.status = 'completed') AS completed,
  count(*) FILTER (WHERE s.status = 'failed') AS failed,
  count(*) FILTER (WHERE s.status IN ('rejected', 'stopped')) AS stopped,
  COALESCE(sum(v.replies), 0) AS replies,
  COALESCE(sum(v.blocked), 0) AS blocked,
  COALESCE(sum(v.edited), 0) AS edited,
  COALESCE(sum(v.escalated), 0) AS escalated,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(0, extract(epoch FROM (s.finished_at - s.started_at)) - s.waited_ms / 1000.0))
    FILTER (WHERE s.status = 'completed' AND s.finished_at IS NOT NULL) AS median_seconds,
  max(s.started_at) AS last_used_at
FROM s
LEFT JOIN v ON v.session_id = s.id
GROUP BY s.user_id, s.tool_id;
REVOKE ALL ON public.outer_control_tool_record FROM PUBLIC, anon;
GRANT SELECT ON public.outer_control_tool_record TO authenticated, service_role;
