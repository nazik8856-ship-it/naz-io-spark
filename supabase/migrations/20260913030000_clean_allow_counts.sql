-- Correctness-audit fix: a clean mode="fast" control-api allow (no hard
-- rule/safety/spend-cap/breaker stopped it) has never written an
-- agent_decisions row at all -- a deliberate perf/cost choice for the
-- common, cheap "nothing happened" case. But key-performance.ts's
-- keyUptimeStats and platform-status.ts's classifyPlatformStatus both
-- compute their denominator FROM agent_decisions, so a key or platform
-- seeing mostly clean fast-mode traffic reports uptime/error-rate far
-- worse than reality (almost all of its real, successful traffic is
-- invisible to the denominator while every failure still shows up).
--
-- Fixed with a lightweight, row-free counter -- NOT a full agent_decisions
-- insert per clean allow, which would undo the exact perf/cost win that
-- made this path skip logging in the first place. Same fixed-window
-- atomic-increment shape as rate_limit_windows/increment_rate_limit
-- (20260819040000_rate_limits.sql), minute-granularity so the platform
-- status endpoint's 15-minute lookback stays accurate.
CREATE TABLE public.clean_allow_counts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, window_start)
);

CREATE INDEX clean_allow_counts_window_idx ON public.clean_allow_counts (window_start);

GRANT ALL ON public.clean_allow_counts TO service_role;
ALTER TABLE public.clean_allow_counts ENABLE ROW LEVEL SECURITY;
-- No authenticated-role policies -- purely a server-side counter, same as
-- rate_limit_windows, never read or written directly by a client.

CREATE OR REPLACE FUNCTION public.increment_clean_allow_count(_user_id uuid, _api_key_id uuid, _window_start timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.clean_allow_counts (user_id, api_key_id, window_start, count)
  VALUES (_user_id, _api_key_id, _window_start, 1)
  ON CONFLICT (api_key_id, window_start)
  DO UPDATE SET count = public.clean_allow_counts.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_clean_allow_count(uuid, uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_clean_allow_count(uuid, uuid, timestamptz) TO service_role;
