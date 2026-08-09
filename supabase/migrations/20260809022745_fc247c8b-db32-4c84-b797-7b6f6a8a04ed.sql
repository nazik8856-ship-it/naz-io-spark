CREATE TABLE public.ai_spend_caps (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_cap_usd numeric(10,2) NOT NULL DEFAULT 5.00,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ai_spend_caps TO authenticated;
GRANT ALL ON public.ai_spend_caps TO service_role;
ALTER TABLE public.ai_spend_caps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own spend cap" ON public.ai_spend_caps FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Create own spend cap" ON public.ai_spend_caps FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update own spend cap" ON public.ai_spend_caps FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER ai_spend_caps_updated_at BEFORE UPDATE ON public.ai_spend_caps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  calls integer NOT NULL DEFAULT 0,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  warned_at timestamptz,
  capped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

GRANT SELECT ON public.ai_spend_daily TO authenticated;
GRANT ALL ON public.ai_spend_daily TO service_role;
ALTER TABLE public.ai_spend_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own spend usage" ON public.ai_spend_daily FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER ai_spend_daily_updated_at BEFORE UPDATE ON public.ai_spend_daily
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kill_switch_source text,
  ADD COLUMN IF NOT EXISTS kill_switch_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kill_switch_at timestamptz;

CREATE OR REPLACE FUNCTION public.guard_kill_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if new.kill_switch is distinct from old.kill_switch
     and auth.role() <> 'service_role'
     and not public.has_role(auth.uid(), 'owner') then
    raise exception 'not authorized to change kill switch';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_ai_spend(
  _user_id uuid,
  _cost_usd numeric,
  _prompt_tokens bigint DEFAULT 0,
  _completion_tokens bigint DEFAULT 0
)
RETURNS TABLE(day date, calls integer, cost_usd numeric, cap_usd numeric, pct numeric, warned_at timestamptz, capped_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cap numeric;
  v_enabled boolean;
  v_row public.ai_spend_daily;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT c.daily_cap_usd, c.enabled INTO v_cap, v_enabled
  FROM public.ai_spend_caps c WHERE c.user_id = _user_id;
  IF v_cap IS NULL THEN
    INSERT INTO public.ai_spend_caps (user_id) VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    v_cap := 5.00;
    v_enabled := true;
  END IF;

  INSERT INTO public.ai_spend_daily (user_id, day, calls, prompt_tokens, completion_tokens, cost_usd)
  VALUES (_user_id, (now() AT TIME ZONE 'utc')::date, 1, COALESCE(_prompt_tokens,0), COALESCE(_completion_tokens,0), COALESCE(_cost_usd,0))
  ON CONFLICT (user_id, day) DO UPDATE SET
    calls = public.ai_spend_daily.calls + 1,
    prompt_tokens = public.ai_spend_daily.prompt_tokens + COALESCE(_prompt_tokens,0),
    completion_tokens = public.ai_spend_daily.completion_tokens + COALESCE(_completion_tokens,0),
    cost_usd = public.ai_spend_daily.cost_usd + COALESCE(_cost_usd,0),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.day, v_row.calls, v_row.cost_usd, v_cap,
    CASE WHEN v_cap > 0 THEN round((v_row.cost_usd / v_cap) * 100, 2) ELSE 0 END,
    v_row.warned_at, v_row.capped_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric, bigint, bigint) TO service_role;