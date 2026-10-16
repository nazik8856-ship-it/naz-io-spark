-- Outer Control: real completion criteria.
--
-- A session is "completed" only after a checklist of criteria passed (see
-- supabase/functions/_shared/outer-control-completion.ts). The last checklist is kept on the session and every
-- evaluation is appended to outer_control_completion_checks so a "Completed" can be audited later.
--
-- Apply this file first. The trigger that enforces the rule is in the next migration file and is applied only
-- after the new session code is deployed (old code does not write a checklist and would be refused).

ALTER TABLE public.outer_control_sessions ADD COLUMN IF NOT EXISTS completion jsonb;

CREATE TABLE IF NOT EXISTS public.outer_control_completion_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.outer_control_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_no integer NOT NULL DEFAULT 0,
  -- 1 for the first evaluation of the result, 2 after it was sent back once, and so on.
  attempt integer NOT NULL DEFAULT 1,
  outcome text NOT NULL CHECK (outcome IN ('completed', 'blocked', 'retry', 'needs_attention', 'failed')),
  passed boolean NOT NULL,
  -- [{id, label, ok (true | false | null = not evaluated), detail}]
  criteria jsonb NOT NULL,
  summary text NOT NULL,
  -- SHA-256 of the checked text; the text itself is the session's final_output.
  output_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outer_control_completion_checks_session_idx ON public.outer_control_completion_checks (session_id, created_at);
CREATE INDEX IF NOT EXISTS outer_control_completion_checks_user_idx ON public.outer_control_completion_checks (user_id, created_at DESC);

ALTER TABLE public.outer_control_completion_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their completion checks" ON public.outer_control_completion_checks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Team members read the owner's completion checks" ON public.outer_control_completion_checks FOR SELECT USING (is_account_member(user_id));
-- Append-only for everyone but the service role (which writes it from the edge function).
GRANT SELECT ON public.outer_control_completion_checks TO authenticated;
GRANT ALL ON public.outer_control_completion_checks TO service_role;
