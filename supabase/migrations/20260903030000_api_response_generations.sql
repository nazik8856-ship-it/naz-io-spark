-- "White-labeled 'brain' endpoint" plan, item 8: a real, queryable record
-- of every generated response -- what was asked (truncated), whether the
-- grounding check or sanitizer had to intervene, and how long it took --
-- without forcing this into agent_decisions' verdict-shaped schema
-- (allow/block/escalate), which doesn't fit a generated-text response at
-- all. Written once per REAL (non-test) call, matching this project's own
-- "log for real observability, skip it for pure test-mode traffic"
-- convention (sandbox-mode.ts / countsTowardRealUsage).
CREATE TABLE IF NOT EXISTS public.api_response_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  is_test boolean NOT NULL DEFAULT false,
  message text NOT NULL,
  grounding_check_intervened boolean NOT NULL DEFAULT false,
  sanitizer_intervened boolean NOT NULL DEFAULT false,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_response_generations_key_idx
  ON public.api_response_generations (api_key_id, created_at DESC);

GRANT SELECT ON public.api_response_generations TO authenticated;
GRANT ALL ON public.api_response_generations TO service_role;

ALTER TABLE public.api_response_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and team members read their api response generations"
  ON public.api_response_generations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_account_member(user_id));
