-- "Own decision-making machine" plan, item 181: usage tracking + cleanup
-- for the three tables /respond's pipeline writes to that item 78/13's
-- retention-sweep predates and has never covered.
--
-- Three tables, three different answers, deliberately NOT one uniform
-- treatment:
--
--  * api_key_context_entries ("context"): these are an account owner's
--    own curated facts, not a log -- they never expire and are never
--    auto-deleted just for being old or unused (that would silently
--    destroy real configuration). What they get is USAGE TRACKING ONLY:
--    use_count/last_used_at, so an account owner can actually see which
--    entries are pulling weight and which are dead weight worth manually
--    removing -- the same "surface it, let the owner decide" posture as
--    api_keys.last_used_at already uses for keys themselves.
--  * api_response_cache ("cache"): pure ephemeral entries with their own
--    explicit expires_at (see 20260905030000_response_cache.sql) --
--    cleanup here is unconditional deletion of anything already past its
--    own TTL, with no per-account retention_days involved at all (a
--    cache row's lifetime was never meant to depend on that setting).
--  * api_response_generations ("decision" -- one row per /respond call,
--    the closest thing this feature has to agent_decisions): a real
--    audit/observability log that grows forever exactly like
--    agent_decisions did before item 78, and for the same reason should
--    be swept on the account's own retention_days window -- extending
--    the EXISTING retention-sweep function (see its own header comment
--    for why policy_watch_observations got the same treatment last
--    round), not standing up a second cron job to do the same job twice.
ALTER TABLE public.api_key_context_entries
  ADD COLUMN use_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_used_at timestamptz;

-- Called from control-api/index.ts's /respond handler, once per real
-- (non-test) call that actually synthesized an answer from one or more
-- entries -- best-effort, never allowed to block or fail the response
-- that already succeeded. Takes every used entry id in one call rather
-- than one round-trip per entry (an answer can cite several).
CREATE FUNCTION public.record_context_entry_usage(_entry_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.api_key_context_entries
  SET use_count = use_count + 1, last_used_at = now()
  WHERE id = ANY(_entry_ids);
$$;

REVOKE ALL ON FUNCTION public.record_context_entry_usage(uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_context_entry_usage(uuid[]) TO service_role;

-- Supports retention-sweep's new per-account cleanup of old decision rows
-- (filters on user_id + created_at); mirrors the (api_key_id, created_at)
-- index this table already has for the key-scoped read paths.
CREATE INDEX idx_api_response_generations_user_created
  ON public.api_response_generations (user_id, created_at);

-- Supports retention-sweep's new unconditional "past its own TTL" cache
-- purge, which scans across all accounts at once rather than per-profile
-- (a cache row's lifetime was never tied to any account setting).
CREATE INDEX idx_api_response_cache_expires
  ON public.api_response_cache (expires_at);
