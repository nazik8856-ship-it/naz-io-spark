-- GAP 8 (Speed & Reliability Layer): GeneratorHome.tsx's own 4-stage
-- progress indicator was a blind client-side timer, cycling through
-- generic labels on a fixed 4-second clock regardless of what the single
-- blocking compile-*-manifest call was actually doing -- indistinguishable
-- from a genuinely stuck request until the 60s timeout fired. This table
-- lets each generation request's real phase boundaries (profile loaded,
-- AI call started, critique running, safety gate running, saved) be
-- reported as they actually happen, so the client can poll real progress
-- instead of faking it. Short-lived by design: a row is only ever read
-- while its own request is in flight, never queried historically.
create table if not exists public.generation_progress (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage text not null,
  updated_at timestamptz not null default now()
);

grant select on public.generation_progress to authenticated;
grant all on public.generation_progress to service_role;

alter table public.generation_progress enable row level security;

create policy "Owners read their own generation progress"
  on public.generation_progress for select to authenticated
  using (auth.uid() = user_id);

-- Progress rows are small and self-expiring in practice (a fresh request
-- always uses a fresh request_id, never reused) -- a periodic sweep keeps
-- the table from growing unbounded from abandoned/never-polled requests.
-- A plain SQL function, not an edge function, so it's scheduled directly
-- via pg_cron below -- no HTTP call or vault secret needed, unlike this
-- project's edge-function sweeps (stuck-approval-sweep and friends).
create or replace function public.sweep_stale_generation_progress()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.generation_progress where updated_at < now() - interval '1 hour';
$$;

select cron.schedule(
  'sweep-stale-generation-progress-hourly',
  '0 * * * *',
  $$select public.sweep_stale_generation_progress();$$
);
