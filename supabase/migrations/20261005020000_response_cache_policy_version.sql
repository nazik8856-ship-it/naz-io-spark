-- GAP 6 (Persistent Ongoing Enforcement): api_response_cache had no notion
-- of WHICH policy version an answer was grounded/safety-checked against.
-- A cache hit (exact OR near-duplicate) replayed the stored answer
-- verbatim for up to its 24h TTL with zero re-check against whatever
-- hard_rules/safety_rules govern this account RIGHT NOW -- the incoming
-- MESSAGE gets scanned fresh on every call (control-api/index.ts's own
-- safetyScan), but the cached ANSWER itself never did. An account owner
-- who tightened a rule mid-day had no way to stop an already-cached,
-- now-noncompliant answer from continuing to be served until its TTL
-- happened to expire on its own.
--
-- Tags every cache write with the exact policy_version active at write
-- time (get_active_policy_version's own self-healing snapshot id -- the
-- SAME mechanism agent_decisions.policy_version already pins every agent
-- decision to), so a lookup can require an exact match and fall through
-- to a fresh, fully re-governed answer the instant the account's rules
-- change -- forcing the same re-sync cadence agents already get instead
-- of waiting out a blind TTL.
alter table public.api_response_cache add column policy_version integer;

create index if not exists api_response_cache_policy_version_idx
  on public.api_response_cache (api_key_id, message_hash, policy_version);

create or replace function public.search_response_cache(
  _api_key_id uuid,
  _embedding vector(768),
  _policy_version integer,
  _limit int default 3
)
returns table(answer text, sources jsonb, confidence text, similarity float)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;
  return query
  select
    c.answer,
    c.sources,
    c.confidence,
    (1 - (c.embedding <=> _embedding))::float as similarity
  from public.api_response_cache c
  where c.api_key_id = _api_key_id
    and c.embedding is not null
    and c.expires_at > now()
    and c.policy_version = _policy_version
  order by c.embedding <=> _embedding
  limit greatest(1, least(_limit, 20));
end;
$$;

revoke all on function public.search_response_cache(uuid, vector, integer, int) from public, anon, authenticated;
grant execute on function public.search_response_cache(uuid, vector, integer, int) to service_role;

-- The old 3-arg overload must be DROPPED, not just superseded -- Postgres
-- happily keeps both signatures otherwise, and response-cache.ts's single
-- call site is the only caller, so nothing else depends on the old shape.
drop function if exists public.search_response_cache(uuid, vector, int);
