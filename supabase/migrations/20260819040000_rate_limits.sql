-- Rate limiting for control-engine's inbound API. Nothing today stops a
-- misbehaving client from hammering the endpoint. Fixed-window counter,
-- atomically incremented server-side (same reasoning as record_ai_spend /
-- record_approval_signoff — a plain client-side upsert can't increment
-- atomically under concurrent requests).
CREATE TABLE public.rate_limit_windows (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
);

GRANT ALL ON public.rate_limit_windows TO service_role;
ALTER TABLE public.rate_limit_windows ENABLE ROW LEVEL SECURITY;
-- No authenticated-role policies — this is a purely server-side counter,
-- never read or written directly by a client.

CREATE OR REPLACE FUNCTION public.increment_rate_limit(_user_id uuid, _endpoint text, _window_start timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rate_limit_windows (user_id, endpoint, window_start, count)
  VALUES (_user_id, _endpoint, _window_start, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET count = public.rate_limit_windows.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) TO service_role;
