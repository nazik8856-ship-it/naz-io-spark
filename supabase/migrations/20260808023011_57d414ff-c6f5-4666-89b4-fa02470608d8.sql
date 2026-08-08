
do $$ begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('owner','admin','user');
  end if;
end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_roles' and policyname='Users can read their own roles') then
    create policy "Users can read their own roles" on public.user_roles
      for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

insert into public.user_roles (user_id, role)
values ('d4f195b5-7225-4dd6-b186-3b5f9ff88665', 'owner')
on conflict (user_id, role) do nothing;

-- Only the owner may change the kill switch
create or replace function public.guard_kill_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kill_switch is distinct from old.kill_switch
     and not public.has_role(auth.uid(), 'owner') then
    raise exception 'not authorized to change kill switch';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_kill_switch_trg on public.profiles;
create trigger guard_kill_switch_trg
before update on public.profiles
for each row execute function public.guard_kill_switch();
