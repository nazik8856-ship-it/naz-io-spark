-- "Outer NazAI" plan, item 7: pre-auth, IP-keyed rate limiting for
-- control-api.
--
-- The existing rate_limit_windows/increment_rate_limit (20260819040000)
-- keys strictly on user_id uuid REFERENCES auth.users(id) -- correct for
-- every prior caller, which was always already authenticated by the time
-- it rate-limited. control-api is the first surface in this project that
-- needs to throttle requests BEFORE authentication succeeds (blunting
-- brute-forcing/probing invalid API keys before each guess spends a hash +
-- indexed DB lookup) -- there is no real user_id yet at that point, so a
-- separate, IP-keyed counter is needed rather than forcing an IP string
-- into a uuid FK column.
--
-- Same fixed-window, atomically-incremented shape as increment_rate_limit,
-- just keyed on (ip, endpoint, window_start) instead of (user_id, endpoint,
-- window_start).
CREATE TABLE public.ip_rate_limit_windows (
  ip text NOT NULL,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, endpoint, window_start)
);

GRANT ALL ON public.ip_rate_limit_windows TO service_role;
ALTER TABLE public.ip_rate_limit_windows ENABLE ROW LEVEL SECURITY;
-- No authenticated-role policies -- purely server-side, never read or
-- written directly by a client, same as rate_limit_windows.

CREATE OR REPLACE FUNCTION public.increment_ip_rate_limit(_ip text, _endpoint text, _window_start timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.ip_rate_limit_windows (ip, endpoint, window_start, count)
  VALUES (_ip, _endpoint, _window_start, 1)
  ON CONFLICT (ip, endpoint, window_start)
  DO UPDATE SET count = public.ip_rate_limit_windows.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_ip_rate_limit(text, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_ip_rate_limit(text, text, timestamptz) TO service_role;
