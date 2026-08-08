
drop policy if exists "Users manage their own agent decisions" on public.agent_decisions;

revoke update, delete on public.agent_decisions from authenticated, anon;
grant select, insert on public.agent_decisions to authenticated;
grant all on public.agent_decisions to service_role;

create policy "Users can read their own agent decisions" on public.agent_decisions
  for select to authenticated using (auth.uid() = user_id);

create policy "Users can append their own agent decisions" on public.agent_decisions
  for insert to authenticated with check (auth.uid() = user_id);
