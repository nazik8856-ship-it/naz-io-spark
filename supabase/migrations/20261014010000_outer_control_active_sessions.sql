-- Outer Control, active capabilities: external tools it can contact, the
-- sessions it drives against them, and one row per exchange.
--
-- All writes go through the outer-control-drive / outer-control-session-sweep
-- edge functions (service role): credentials live in the vault via
-- create_integration_secret and must never be written from a client. Owners
-- and team members can read.
CREATE TABLE public.external_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  endpoint_url text NOT NULL,
  request_format text NOT NULL DEFAULT 'generic_json'
    CHECK (request_format IN ('openai_chat', 'anthropic_messages', 'generic_json')),
  model text,
  auth_header text NOT NULL DEFAULT 'Authorization',
  -- Prefix put before the token, e.g. 'Bearer ' ('' for headers like x-api-key).
  auth_scheme text NOT NULL DEFAULT 'Bearer ',
  credentials_secret_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  -- NULL until a person approved contacting this destination for the first time.
  approved_at timestamptz,
  approved_by uuid,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX external_tools_user_idx ON public.external_tools (user_id, created_at DESC);

CREATE TABLE public.outer_control_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES public.external_tools(id) ON DELETE CASCADE,
  -- The API key whose rules govern the replies (NULL = account-wide rules only).
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 1 AND 2000),
  context text CHECK (context IS NULL OR char_length(context) <= 8000),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'awaiting_human', 'completed', 'rejected', 'failed', 'cancelled', 'stopped')),
  step_count integer NOT NULL DEFAULT 0,
  max_steps integer NOT NULL DEFAULT 5 CHECK (max_steps BETWEEN 1 AND 20),
  max_retries integer NOT NULL DEFAULT 1 CHECK (max_retries BETWEEN 0 AND 3),
  -- Attempts already used on the step in progress (block retries and failure retries).
  retries_used integer NOT NULL DEFAULT 0,
  failures_used integer NOT NULL DEFAULT 0,
  correction text,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_input text,
  final_output text,
  stop_reason text,
  -- Why a person is needed right now, and what resolves it.
  pending_kind text CHECK (pending_kind IS NULL OR pending_kind IN ('first_contact', 'contact_gate', 'reply_approval', 'question')),
  pending_approval_id uuid REFERENCES public.pending_approvals(id) ON DELETE SET NULL,
  pending_step_no integer,
  pending_question text,
  pending_answer text,
  -- Highest step number whose outbound contact has already been cleared by the gate/approval.
  gate_cleared_step integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX outer_control_sessions_user_idx ON public.outer_control_sessions (user_id, started_at DESC);
CREATE INDEX outer_control_sessions_open_idx ON public.outer_control_sessions (status) WHERE status IN ('running', 'awaiting_human');

CREATE TABLE public.outer_control_session_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.outer_control_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_no integer NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  -- What was sent (secrets masked) and what came back (secrets masked).
  request jsonb,
  reply_text text,
  tool_status text,
  http_status integer,
  error text,
  evaluation_id uuid REFERENCES public.outer_control_evaluations(id) ON DELETE SET NULL,
  verdict text CHECK (verdict IS NULL OR verdict IN ('allow', 'modify', 'block', 'escalate')),
  next_action text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, step_no, attempt)
);
CREATE INDEX outer_control_session_steps_session_idx ON public.outer_control_session_steps (session_id, step_no, attempt);

ALTER TABLE public.external_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outer_control_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outer_control_session_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their external tools" ON public.external_tools FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Team members read the owner's external tools" ON public.external_tools FOR SELECT USING (is_account_member(user_id));
CREATE POLICY "Owners read their outer control sessions" ON public.outer_control_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Team members read the owner's outer control sessions" ON public.outer_control_sessions FOR SELECT USING (is_account_member(user_id));
CREATE POLICY "Owners read their session steps" ON public.outer_control_session_steps FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Team members read the owner's session steps" ON public.outer_control_session_steps FOR SELECT USING (is_account_member(user_id));

GRANT SELECT ON public.external_tools, public.outer_control_sessions, public.outer_control_session_steps TO authenticated;
GRANT ALL ON public.external_tools, public.outer_control_sessions, public.outer_control_session_steps TO service_role;

-- ============================================================
-- POST-MIGRATION STEP (applied directly; needs the project URL and vault key):
--
--    SELECT cron.schedule(
--      'outer-control-session-sweep-1min',
--      '* * * * *',
--      $$
--      INSERT INTO public.scheduled_job_requests (job_name, request_id)
--      SELECT 'outer-control-session-sweep-1min', net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/outer-control-session-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
--    Stop it: SELECT cron.unschedule('outer-control-session-sweep-1min');
--    Or pause every consequential sweep: platform_settings.consequential_sweeps_paused = true.
-- ============================================================
