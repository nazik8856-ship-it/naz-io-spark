-- GAP 8 (Speed & Reliability Layer): a repeated/duplicate generation
-- request (a double-submit, or a retry after a network blip on
-- GeneratorHome.tsx's own fetch) previously always re-ran the full AI
-- pipeline from scratch -- one or two real model calls (generation, then
-- GAP 7's critique-and-revise), every time, even for the exact same
-- input. Caches the compiled manifest for an IDENTICAL generation
-- request (same plan/prompt/profile/role, hashed) for a short window --
-- long enough to catch an accidental duplicate submit, short enough that
-- a real edit minutes later always re-generates for real rather than
-- risking a meaningfully stale result. A cache hit still runs the
-- deterministic pre-save gates (hard-rule tool-stripping, safety scan,
-- fact-check) fresh every time -- only the expensive AI call(s) are
-- skipped, never the enforcement layer.
create table if not exists public.generation_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('agent', 'website')),
  cache_key text not null,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists generation_cache_user_kind_key_idx
  on public.generation_cache (user_id, kind, cache_key);

grant select on public.generation_cache to authenticated;
grant all on public.generation_cache to service_role;

alter table public.generation_cache enable row level security;

create policy "Owners read their own generation cache"
  on public.generation_cache for select to authenticated
  using (auth.uid() = user_id);
