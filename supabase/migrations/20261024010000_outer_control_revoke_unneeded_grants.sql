-- Outer Control tables: take away the table grants nobody needs.
--
-- Row level security already stops anonymous and signed-in users from writing these tables (the only policies are SELECT, plus
-- the one INSERT policy on outer_control_evaluations). The default Supabase grants still hand every role INSERT, UPDATE, DELETE,
-- TRUNCATE and more on each table. TRUNCATE is not covered by row level security at all, so this removes the grants as well:
-- a later mistaken policy then cannot open a write path by itself.
--   anon           : nothing on these tables
--   authenticated  : read only (SELECT is left exactly as it is, including the column-level SELECT on external_tools that hides
--                    the credential id); the edge functions write with the service role
--   outer_control_evaluations : signed-in users may still append their own rows, as their policy says
REVOKE ALL ON TABLE
  public.external_tools,
  public.outer_control_sessions,
  public.outer_control_session_steps,
  public.outer_control_evaluations,
  public.outer_control_workflows,
  public.outer_control_task_handoffs,
  public.outer_control_memory,
  public.outer_control_corrections,
  public.outer_control_completion_checks
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.external_tools,
  public.outer_control_sessions,
  public.outer_control_session_steps,
  public.outer_control_evaluations,
  public.outer_control_workflows,
  public.outer_control_task_handoffs,
  public.outer_control_memory,
  public.outer_control_corrections,
  public.outer_control_completion_checks
FROM authenticated;

GRANT INSERT ON TABLE public.outer_control_evaluations TO authenticated;
