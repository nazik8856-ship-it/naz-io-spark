
create table public.hard_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_text text not null,
  action_type_pattern text not null default '*',
  effect text not null default 'always_block' check (effect in ('always_block','always_require_approval')),
  provider text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.hard_rules to authenticated;
grant all on public.hard_rules to service_role;

alter table public.hard_rules enable row level security;

create policy "Users manage their own hard rules" on public.hard_rules
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger hard_rules_updated_at
before update on public.hard_rules
for each row execute function public.update_updated_at_column();

create index hard_rules_user_enabled_idx on public.hard_rules (user_id, enabled);
