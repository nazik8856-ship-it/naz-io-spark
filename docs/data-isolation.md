# User & data isolation

One account must never reach another account's projects, data, rules, conversations or connected tools. This page is the
rule, the register that applies it to every table and function, and how gaps are found.

## The rule

- **Every row has an owner**: the account owner's user id, in `user_id` (`id` for `profiles`, `account_owner_id` for team
  membership rows). A row that belongs to another row (a page to its website) carries the same owner, copied by the database.
- **Who may reach a row**: its owner, or an active member of the owner's team (`account_members`, checked by
  `is_account_member(owner, role, permission)`) at the role the table needs: viewers read, approvers sign off, team owners (with
  the matching permission) change rules, spend caps, integrations and webhooks. Nobody else.
- **Where it is enforced**:
  1. the database (row level security on every table, policies that check `auth.uid()` or `is_account_member`);
  2. the edge functions: the caller is taken from their sign-in token, never from the request body; a function that uses the
     server key, which bypasses row level security, must filter every query by that caller's account;
  3. the website reads and writes only through those two.
- **The server key** is for scheduled jobs and server-to-server calls only, and those functions check for it.

## The register

`isolation_tables` (server only) has one row per table: its access type and owner column.

| Access | Who | Examples |
| --- | --- | --- |
| `team` | owner, or a team member at the table's role | agents, rules, approvals, Outer Control, API keys, webhooks, projects imported for Outer Control |
| `owner` | the owner only | Generator requests, agent runs, credits, form submissions, website versions |
| `public_by_link` | one item opened by its link; owner-only otherwise | websites, website pages, shared websites |
| `self` | a person's own row | profiles, user roles |
| `membership` | the team owner and the member | account members, notification preferences |
| `platform` | NazAI staff (`has_role`) | platform incidents, scheduled job log; the kill switch every screen reads (`read_all_reason`) |
| `shared_aggregate` | every signed-in user, combined numbers only | cross-account precedent counts (`read_all_reason`) |
| `system_only` | no browser access | OAuth state, rate limits, email logs, idempotency keys, the registers themselves |

Edge functions are registered in `supabase/functions/_shared/function-access.ts`: `user` (the caller's sign-in token is verified,
or the query runs as the caller), `api_key` (the account comes from the NazAI API key), `system` (requires the server key) or
`public` (reachable without signing in on purpose, with the reason and what protects it: OAuth callbacks trust only their one-time
state, the Resend webhook only a valid signature, website forms are stored for the site owner only, …).

## Finding gaps

`select * from isolation_report();` (server only) returns one row per gap:

| Kind | Meaning |
| --- | --- |
| `unregistered_table` | a table missing from the register (or registered but gone) |
| `rls_off` | row level security is off |
| `read_all` | a policy lets visitors or signed-in users read every row, without a recorded reason |
| `no_identity_check` | a policy for visitors or signed-in users checks neither the caller, their team, nor their role |
| `system_table_exposed` | a `system_only` table has a policy that lets visitors or signed-in users in |
| `owner_nullable` | the owner column of an `owner`, `team` or `public_by_link` table can be empty |
| `unchecked_function` | a `SECURITY DEFINER` database function (it bypasses row level security) that visitors or signed-in users can call and that never checks who is calling |

Build checks: `src/test/data-isolation.test.ts` (a table created by a migration must be registered) and
`src/test/function-access.test.ts` (every edge function is registered, and its code checks its caller the way its entry says).
Database test: `supabase/tests/secrets/isolation_register_test.sql`.

## Known gaps (front 1 baseline)

What the report and the function register show today; fronts 2–4 close them.

- `read_all` on `websites`, `website_pages` and `shared_websites`: every site, with its prompt and notes, can be listed by anyone.
  Front 2 replaces this with a lookup of one published site by its link that returns only what the page shows.
- `unchecked_function`: database functions that take a user id and never check the caller (`get_active_policy_version`,
  `build_policy_snapshot`, `delete_expired_agent_events`, the rate-limit counters, `has_role`, `sweep_stale_generation_progress`).
  Front 2 limits them to the server or makes them check the caller.
- Edge functions: `agent-scheduler` (no check on incoming requests), `calibrate-confidence` and `measure-decision-outcomes` (the
  account comes from the request body). Front 3.

## Files

`mission-assets` keeps each user's uploads under their own folder (`<user id>/…`); uploads are limited to that folder and the
bucket can not be listed. `governance-backups` is private (server only). See `docs/data-encryption.md`.
