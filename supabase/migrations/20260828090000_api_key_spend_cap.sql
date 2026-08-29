-- "Zero human review" plan, item 12: today's AI-spend cap protects the
-- whole account, or one specific internal agent -- but a fully-automated
-- external integration calling the Control API in "full" (AI-scored)
-- mode could, on its own, spend the account's entire daily AI budget
-- with nothing account-wide left over for anything else. Let an account
-- set a separate ceiling just for one key.
--
-- Mirrors the per-agent cap's exact shape (20260821020000_per_agent_
-- spend_cap.sql) -- a third, parallel dimension alongside the
-- account-wide and per-agent rows, never a replacement for either. A key
-- with no cap of its own has no key-level enforcement at all, only the
-- account-wide cap applies to it, exactly as before this existed.
--
-- api_key_id and agent_id are mutually exclusive on the same row --
-- control-api's own mode="full" forward always passes agentId: null
-- (control-api never ties an action to an internal agent), so these two
-- dimensions never combine in real traffic; the CHECK constraint makes
-- that a guarantee, not just an assumption.
ALTER TABLE public.ai_spend_caps
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES public.api_keys(id) ON DELETE CASCADE;
ALTER TABLE public.ai_spend_caps
  ADD CONSTRAINT ai_spend_caps_agent_or_key_not_both CHECK (agent_id IS NULL OR api_key_id IS NULL);
CREATE UNIQUE INDEX idx_ai_spend_caps_per_key ON public.ai_spend_caps (user_id, api_key_id) WHERE api_key_id IS NOT NULL;

ALTER TABLE public.ai_spend_daily
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES public.api_keys(id) ON DELETE CASCADE;
ALTER TABLE public.ai_spend_daily
  ADD CONSTRAINT ai_spend_daily_agent_or_key_not_both CHECK (agent_id IS NULL OR api_key_id IS NULL);
CREATE UNIQUE INDEX idx_ai_spend_daily_per_key ON public.ai_spend_daily (user_id, day, api_key_id) WHERE api_key_id IS NOT NULL;

-- record_ai_spend: same treatment as the per-agent addition -- always
-- upserts the account-wide row (unchanged), ADDITIONALLY upserts a
-- per-agent row when _agent_id is given, and now ADDITIONALLY upserts a
-- per-key row when _api_key_id is given. Does NOT auto-create a
-- per-key cap row -- a key with no cap explicitly set has no key-level
-- enforcement, same as an agent with no cap.
DROP FUNCTION IF EXISTS public.record_ai_spend(uuid, numeric, bigint, bigint, uuid);

CREATE FUNCTION public.record_ai_spend(
  _user_id uuid,
  _cost_usd numeric,
  _prompt_tokens bigint DEFAULT 0,
  _completion_tokens bigint DEFAULT 0,
  _agent_id uuid DEFAULT NULL,
  _api_key_id uuid DEFAULT NULL
)
RETURNS TABLE(
  day date,
  account_calls integer, account_cost_usd numeric, account_cap_usd numeric, account_pct numeric,
  account_warned_at timestamptz, account_capped_at timestamptz,
  agent_has_cap boolean,
  agent_calls integer, agent_cost_usd numeric, agent_cap_usd numeric, agent_pct numeric,
  agent_warned_at timestamptz, agent_capped_at timestamptz,
  key_has_cap boolean,
  key_calls integer, key_cost_usd numeric, key_cap_usd numeric, key_pct numeric,
  key_warned_at timestamptz, key_capped_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cap numeric;
  v_enabled boolean;
  v_account_row public.ai_spend_daily;
  v_agent_cap numeric;
  v_agent_enabled boolean;
  v_agent_has_cap boolean := false;
  v_agent_row public.ai_spend_daily;
  v_key_cap numeric;
  v_key_enabled boolean;
  v_key_has_cap boolean := false;
  v_key_row public.ai_spend_daily;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- ---- account-wide (unchanged behavior) ----
  SELECT c.daily_cap_usd, c.enabled INTO v_cap, v_enabled
  FROM public.ai_spend_caps c WHERE c.user_id = _user_id AND c.agent_id IS NULL AND c.api_key_id IS NULL;
  IF v_cap IS NULL THEN
    INSERT INTO public.ai_spend_caps (user_id) VALUES (_user_id)
    ON CONFLICT (user_id) WHERE agent_id IS NULL DO NOTHING;
    v_cap := 5.00;
    v_enabled := true;
  END IF;

  INSERT INTO public.ai_spend_daily (user_id, day, calls, prompt_tokens, completion_tokens, cost_usd)
  VALUES (_user_id, (now() AT TIME ZONE 'utc')::date, 1, COALESCE(_prompt_tokens,0), COALESCE(_completion_tokens,0), COALESCE(_cost_usd,0))
  ON CONFLICT (user_id, day) WHERE agent_id IS NULL DO UPDATE SET
    calls = public.ai_spend_daily.calls + 1,
    prompt_tokens = public.ai_spend_daily.prompt_tokens + COALESCE(_prompt_tokens,0),
    completion_tokens = public.ai_spend_daily.completion_tokens + COALESCE(_completion_tokens,0),
    cost_usd = public.ai_spend_daily.cost_usd + COALESCE(_cost_usd,0),
    updated_at = now()
  RETURNING * INTO v_account_row;

  -- ---- per-agent (only when _agent_id is given AND that agent has its
  -- own cap configured; otherwise agent_* columns come back null/zero and
  -- the caller applies no agent-level enforcement) ----
  IF _agent_id IS NOT NULL THEN
    SELECT c.daily_cap_usd, c.enabled INTO v_agent_cap, v_agent_enabled
    FROM public.ai_spend_caps c WHERE c.user_id = _user_id AND c.agent_id = _agent_id;
    v_agent_has_cap := v_agent_cap IS NOT NULL;

    IF v_agent_has_cap THEN
      INSERT INTO public.ai_spend_daily (user_id, day, agent_id, calls, prompt_tokens, completion_tokens, cost_usd)
      VALUES (_user_id, (now() AT TIME ZONE 'utc')::date, _agent_id, 1, COALESCE(_prompt_tokens,0), COALESCE(_completion_tokens,0), COALESCE(_cost_usd,0))
      ON CONFLICT (user_id, day, agent_id) WHERE agent_id IS NOT NULL DO UPDATE SET
        calls = public.ai_spend_daily.calls + 1,
        prompt_tokens = public.ai_spend_daily.prompt_tokens + COALESCE(_prompt_tokens,0),
        completion_tokens = public.ai_spend_daily.completion_tokens + COALESCE(_completion_tokens,0),
        cost_usd = public.ai_spend_daily.cost_usd + COALESCE(_cost_usd,0),
        updated_at = now()
      RETURNING * INTO v_agent_row;
    END IF;
  END IF;

  -- ---- per-api-key (item 12): same shape as per-agent, only when
  -- _api_key_id is given AND that key has its own cap configured ----
  IF _api_key_id IS NOT NULL THEN
    SELECT c.daily_cap_usd, c.enabled INTO v_key_cap, v_key_enabled
    FROM public.ai_spend_caps c WHERE c.user_id = _user_id AND c.api_key_id = _api_key_id;
    v_key_has_cap := v_key_cap IS NOT NULL;

    IF v_key_has_cap THEN
      INSERT INTO public.ai_spend_daily (user_id, day, api_key_id, calls, prompt_tokens, completion_tokens, cost_usd)
      VALUES (_user_id, (now() AT TIME ZONE 'utc')::date, _api_key_id, 1, COALESCE(_prompt_tokens,0), COALESCE(_completion_tokens,0), COALESCE(_cost_usd,0))
      ON CONFLICT (user_id, day, api_key_id) WHERE api_key_id IS NOT NULL DO UPDATE SET
        calls = public.ai_spend_daily.calls + 1,
        prompt_tokens = public.ai_spend_daily.prompt_tokens + COALESCE(_prompt_tokens,0),
        completion_tokens = public.ai_spend_daily.completion_tokens + COALESCE(_completion_tokens,0),
        cost_usd = public.ai_spend_daily.cost_usd + COALESCE(_cost_usd,0),
        updated_at = now()
      RETURNING * INTO v_key_row;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_account_row.day, v_account_row.calls, v_account_row.cost_usd, v_cap,
    CASE WHEN v_cap > 0 THEN round((v_account_row.cost_usd / v_cap) * 100, 2) ELSE 0 END,
    v_account_row.warned_at, v_account_row.capped_at,
    v_agent_has_cap,
    v_agent_row.calls, v_agent_row.cost_usd, v_agent_cap,
    CASE WHEN v_agent_has_cap AND v_agent_cap > 0 THEN round((v_agent_row.cost_usd / v_agent_cap) * 100, 2) ELSE 0 END,
    v_agent_row.warned_at, v_agent_row.capped_at,
    v_key_has_cap,
    v_key_row.calls, v_key_row.cost_usd, v_key_cap,
    CASE WHEN v_key_has_cap AND v_key_cap > 0 THEN round((v_key_row.cost_usd / v_key_cap) * 100, 2) ELSE 0 END,
    v_key_row.warned_at, v_key_row.capped_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_spend(uuid, numeric, bigint, bigint, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric, bigint, bigint, uuid, uuid) TO service_role;

-- An account can configure this cap the same way it configures every
-- other per-key setting in this round -- via POST /api-keys/:id/policy
-- (api-keys/index.ts), not a new table row it manages directly.
