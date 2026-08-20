-- Wave 5, session 1: per-agent spend cap with an agent-scoped kill switch.
-- Confirmed with the user: when a per-agent cap trips, it stops ONLY that
-- agent -- the account-wide kill switch and every other agent are
-- untouched. This is deliberately a separate, parallel mechanism
-- alongside the existing account-wide cap/kill-switch, not a replacement
-- for it: an agent with no cap of its own is still governed only by the
-- account-wide cap, exactly as every agent is today.

-- Agent-level kill switch, mirroring profiles' columns for the same
-- meaning (auto-tripped vs. manually flipped, when, by what).
ALTER TABLE public.agents
  ADD COLUMN kill_switch boolean NOT NULL DEFAULT false,
  ADD COLUMN kill_switch_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN kill_switch_source text,
  ADD COLUMN kill_switch_at timestamptz;

-- ai_spend_caps: was one row per account (user_id was the PRIMARY KEY).
-- Restructure to allow one account-wide row (agent_id NULL) PLUS one row
-- per agent that has its own cap configured.
-- NOTE: constraint names below (ai_spend_caps_pkey,
-- ai_spend_daily_user_id_day_key) are Postgres's default auto-generated
-- names for an inline PRIMARY KEY / a table-level UNIQUE(...) -- verify
-- against \d ai_spend_caps / \d ai_spend_daily when this is actually
-- applied, in case either was ever renamed.
ALTER TABLE public.ai_spend_caps DROP CONSTRAINT ai_spend_caps_pkey;
ALTER TABLE public.ai_spend_caps ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.ai_spend_caps ADD CONSTRAINT ai_spend_caps_pkey PRIMARY KEY (id);
ALTER TABLE public.ai_spend_caps ADD COLUMN agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_ai_spend_caps_account_wide ON public.ai_spend_caps (user_id) WHERE agent_id IS NULL;
CREATE UNIQUE INDEX idx_ai_spend_caps_per_agent ON public.ai_spend_caps (user_id, agent_id) WHERE agent_id IS NOT NULL;

-- RLS: existing policies are scoped by user_id = auth.uid(), unaffected
-- by agent_id -- an account owner already manages all of their own cap
-- rows, account-wide or per-agent, through the same policies. Team-owner
-- write access from RBAC Phase 3 (is_account_member(user_id,'owner'))
-- is likewise unaffected -- it targets user_id, not agent_id.

-- ai_spend_daily: track per-agent spend alongside the existing account
-- total. The account-wide row (agent_id NULL) keeps meaning exactly what
-- it means today -- total spend across the whole account, every agent and
-- the chat interface combined. A per-agent row (agent_id set) is that one
-- agent's own subtotal, tracked in parallel, not instead of the total.
ALTER TABLE public.ai_spend_daily DROP CONSTRAINT ai_spend_daily_user_id_day_key;
ALTER TABLE public.ai_spend_daily ADD COLUMN agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_ai_spend_daily_account_wide ON public.ai_spend_daily (user_id, day) WHERE agent_id IS NULL;
CREATE UNIQUE INDEX idx_ai_spend_daily_per_agent ON public.ai_spend_daily (user_id, day, agent_id) WHERE agent_id IS NOT NULL;

-- record_ai_spend: now always upserts the account-wide row (unchanged
-- behavior), and ADDITIONALLY upserts a per-agent row when _agent_id is
-- given -- the same call's cost is recorded at both granularities so the
-- account cap and an optional agent cap can each be checked independently.
-- Does NOT auto-create a per-agent cap row (unlike the account-wide row,
-- which keeps its existing $5-default auto-create behavior) -- an agent
-- with no cap explicitly set has no agent-level enforcement, only the
-- account-wide cap applies to it, same as every agent before this
-- migration.
-- CREATE OR REPLACE only replaces a function with the exact same
-- argument signature -- the new 5-arg version would otherwise sit
-- alongside the old 4-arg one as a separate overload. Drop it explicitly
-- so there's exactly one record_ai_spend, not a stray unused overload.
DROP FUNCTION IF EXISTS public.record_ai_spend(uuid, numeric, bigint, bigint);

CREATE OR REPLACE FUNCTION public.record_ai_spend(
  _user_id uuid,
  _cost_usd numeric,
  _prompt_tokens bigint DEFAULT 0,
  _completion_tokens bigint DEFAULT 0,
  _agent_id uuid DEFAULT NULL
)
RETURNS TABLE(
  day date,
  account_calls integer, account_cost_usd numeric, account_cap_usd numeric, account_pct numeric,
  account_warned_at timestamptz, account_capped_at timestamptz,
  agent_has_cap boolean,
  agent_calls integer, agent_cost_usd numeric, agent_cap_usd numeric, agent_pct numeric,
  agent_warned_at timestamptz, agent_capped_at timestamptz
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
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- ---- account-wide (unchanged behavior) ----
  SELECT c.daily_cap_usd, c.enabled INTO v_cap, v_enabled
  FROM public.ai_spend_caps c WHERE c.user_id = _user_id AND c.agent_id IS NULL;
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

  RETURN QUERY SELECT
    v_account_row.day, v_account_row.calls, v_account_row.cost_usd, v_cap,
    CASE WHEN v_cap > 0 THEN round((v_account_row.cost_usd / v_cap) * 100, 2) ELSE 0 END,
    v_account_row.warned_at, v_account_row.capped_at,
    v_agent_has_cap,
    v_agent_row.calls, v_agent_row.cost_usd, v_agent_cap,
    CASE WHEN v_agent_has_cap AND v_agent_cap > 0 THEN round((v_agent_row.cost_usd / v_agent_cap) * 100, 2) ELSE 0 END,
    v_agent_row.warned_at, v_agent_row.capped_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_spend(uuid, numeric, bigint, bigint, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric, bigint, bigint, uuid) TO service_role;
