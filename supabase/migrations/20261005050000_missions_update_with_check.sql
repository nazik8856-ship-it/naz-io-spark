-- GAP 9 (Security hardening -- RLS audit): "Users can update own missions" had
-- a USING clause (auth.uid() = user_id) but NO WITH CHECK -- every other
-- owner-scoped UPDATE/ALL policy in this schema (hard_rules, agents,
-- agent_memory, circuit_breakers, decision_outcomes, ...) pairs USING with an
-- identical WITH CHECK so a row can't be updated INTO a state the policy
-- wouldn't have allowed. Missing it here meant an authenticated user could
-- UPDATE one of their own mission rows and set user_id to ANY other uid --
-- the row then disappears from their own view (filtered by the unchanged
-- USING clause on their next read) and appears in the target account's
-- mission list instead, with attacker-controlled `directive`/
-- `attachment_urls` content: a cross-account data-injection vector via a
-- plain PostgREST PATCH, not caught by the application code since nothing
-- server-side ever reassigns a mission's owner.
alter policy "Users can update own missions"
  on public.missions
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
