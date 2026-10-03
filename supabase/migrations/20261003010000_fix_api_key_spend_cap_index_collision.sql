-- Fix: per-key spend caps silently corrupt account-wide spend tracking.
--
-- 20260828090000_api_key_spend_cap.sql added api_key_id to ai_spend_caps/
-- ai_spend_daily, but never updated the two PRE-EXISTING "account-wide"
-- partial unique indexes from 20260821020000_per_agent_spend_cap.sql --
-- idx_ai_spend_caps_account_wide (user_id) WHERE agent_id IS NULL and
-- idx_ai_spend_daily_account_wide (user_id, day) WHERE agent_id IS NULL.
-- Both predicates only exclude agent_id, not api_key_id -- but a per-key
-- row ALSO has agent_id IS NULL (agent_id and api_key_id are mutually
-- exclusive on the same row, per the CHECK constraint added in that same
-- migration). So a per-key row collides with these two indexes against
-- the account's own existing account-wide row:
--
--  * ai_spend_caps: inserting a per-key cap (api-keys/index.ts) raises a
--    unique violation on idx_ai_spend_caps_account_wide -- silently,
--    since that insert's result was never checked for an error, so the
--    endpoint reports {ok:true, ai_spend_cap_usd: cap} while nothing was
--    actually saved.
--  * ai_spend_daily: record_ai_spend's per-key upsert branch raises a
--    unique violation on idx_ai_spend_daily_account_wide. Since a
--    PL/pgSQL function body is one transaction, this uncaught exception
--    rolls back the ENTIRE record_ai_spend call -- including the
--    account-wide spend it already recorded moments earlier in the same
--    call -- so once a per-key cap exists, that key's traffic stops
--    updating the account-wide total at all.
--
-- Both indexes need api_key_id IS NULL added to their predicate so a
-- per-key row (agent_id NULL, api_key_id SET) no longer satisfies them.
-- Safe to drop and recreate with no backfill: the ai_spend_caps insert
-- above has never been able to succeed (always collided), so no per-key
-- ai_spend_caps row -- and therefore no per-key ai_spend_daily row
-- either, since record_ai_spend's per-key branch only runs when a
-- per-key cap row already exists -- can exist in current data.
DROP INDEX IF EXISTS public.idx_ai_spend_caps_account_wide;
CREATE UNIQUE INDEX idx_ai_spend_caps_account_wide ON public.ai_spend_caps (user_id) WHERE agent_id IS NULL AND api_key_id IS NULL;

DROP INDEX IF EXISTS public.idx_ai_spend_daily_account_wide;
CREATE UNIQUE INDEX idx_ai_spend_daily_account_wide ON public.ai_spend_daily (user_id, day) WHERE agent_id IS NULL AND api_key_id IS NULL;

-- record_ai_spend's own ON CONFLICT targets must be re-specified to match
-- the new index predicates exactly (Postgres requires the literal
-- predicate text to match an existing unique index to use it as the
-- arbiter) -- otherwise these two statements now hit "no unique or
-- exclusion constraint matching the ON CONFLICT specification" instead.
-- Everything else in the function body is unchanged from
-- 20260828090000_api_key_spend_cap.sql.
CREATE OR REPLACE FUNCTION public.record_ai_spend(
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
    ON CONFLICT (user_id) WHERE agent_id IS NULL AND api_key_id IS NULL DO NOTHING;
    v_cap := 5.00;
    v_enabled := true;
  END IF;

  INSERT INTO public.ai_spend_daily (user_id, day, calls, prompt_tokens, completion_tokens, cost_usd)
  VALUES (_user_id, (now() AT TIME ZONE 'utc')::date, 1, COALESCE(_prompt_tokens,0), COALESCE(_completion_tokens,0), COALESCE(_cost_usd,0))
  ON CONFLICT (user_id, day) WHERE agent_id IS NULL AND api_key_id IS NULL DO UPDATE SET
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
