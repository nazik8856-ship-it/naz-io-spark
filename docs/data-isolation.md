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
| `public_by_link` | one item opened by its link through a database function; the tables themselves are owner/team only | websites, website pages, shared websites |
| `self` | a person's own row | profiles, user roles |
| `membership` | the team owner and the member | account members, notification preferences |
| `platform` | NazAI staff (`has_role`) | platform incidents, scheduled job log; the kill switch every screen reads (`read_all_reason`) |
| `shared_aggregate` | every signed-in user, combined numbers only | cross-account precedent counts (`read_all_reason`) |
| `system_only` | no browser access | OAuth state, rate limits, email logs, idempotency keys, the registers themselves |

Edge functions are registered in `supabase/functions/_shared/function-access.ts`: `user` (the caller's sign-in token is verified,
or the query runs as the caller), `api_key` (the account comes from the NazAI API key), `system` (requires the server key) or
`public` (reachable without signing in on purpose, with the reason and what protects it: OAuth callbacks trust only their one-time
state, the Resend webhook only a valid signature, website forms are stored for the site owner only, …).

Database functions that visitors may call on purpose are listed in `isolation_public_functions` with the reason (today only
`get_public_site`); the report skips exactly those.

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
| `owner_unguarded` | a signed-in user could change the owner of a row: the table has a registered owner column but no `prevent_owner_change` trigger |
| `unchecked_function` | a `SECURITY DEFINER` database function (it bypasses row level security) that visitors or signed-in users can call, that never checks who is calling and is not registered as public on purpose |

Build checks:
- `src/test/data-isolation.test.ts`: a table created by a migration must be registered; the public-site lookup returns only what the
  preview shows; nothing re-creates a read-everything rule on the website tables; the website reads sites through the lookup; the
  closed functions stay closed.
- `src/test/function-access.test.ts`: every edge function is registered, and its code checks its caller the way its entry says (no
  open gaps).
- `src/test/function-ownership.test.ts`: a function may read an account or user id from the request only after verifying it, and a
  server function gaining a query by id with the full-access key and no owner filter fails until it is reviewed.

Database tests: `supabase/tests/secrets/isolation_register_test.sql` and `isolation_front2_test.sql` (signs in as an owner, a stranger,
a team viewer, a member of two accounts and a visitor).

## What fronts 2 and 3 changed

**Database (front 2).** `isolation_report()` returns no rows.
- **Websites are opened by link through `get_public_site(_ref, _meta_only)`**: one site by its id, subdomain or custom domain, with
  only what the public preview renders (name, tagline, theme, picture status, pages). It never returns `prompt`,
  `generation_notes`, `trust_score` or the owner, and it can not list sites. The read-everything rules on `websites`,
  `website_pages` and `shared_websites` are gone; owners read their own rows and team members (viewer and above) their account's.
  The preview page and the share-link title tags (`middleware.ts`) use the lookup.
- **Seven database functions are server-only**: the rate-limit counters (`increment_rate_limit`, `increment_ip_rate_limit`,
  `increment_clean_allow_count`), `delete_expired_agent_events`, `sweep_stale_generation_progress`, `build_policy_snapshot` and
  `get_active_policy_version`. Until now anyone could bump another account's counter until it was locked out, or delete another
  account's old events by passing its id.
- **`has_role` answers only about the caller** for visitors and signed-in users; the server key and database jobs may ask about anyone.
- **The owner of a row can not be changed** by a signed-in user (`prevent_owner_change` on every table with a registered owner
  column). Team-owner rules only check membership of the account a row ends up in, so a team owner of two accounts could have moved a
  rule, webhook or spend cap from one to the other.
- **Cross-account stats** (`cross_account_precedent_stats`) show a row only once at least 2 accounts contributed; before, only the
  server held back the rest while the browser read the table directly.
- **`can_access(owner, min_role[, permission])` is the one helper for "the owner, or a team member at this role"** (and, for changes,
  the permission category). Every team rule calls it (`20261105030000_policies_use_can_access.sql`: 58 rules rewritten in place; the
  test asks four people the same questions before and after and the answers match). One rule is left as it was on purpose:
  `knowledge_base_entries` "Team owners can manage ...", which gives the owner no direct write access (the migration only rewrites a
  rule when the owner has the same access through another rule, and stops if any other rule still calls `is_account_member()`).
  `src/test/data-isolation.test.ts` fails a new rule that calls `is_account_member()` itself.
- The other database functions visitors can call were re-checked: OAuth state, webhook secrets, decision signatures and approvals
  all check the caller; the rest are pure text helpers.

**Server functions (front 3).**
- The three scheduled jobs that answered anyone (`agent-scheduler`, `calibrate-confidence`, `measure-decision-outcomes`) now need the
  server key, which the schedule already sends. No gap is open in `function-access.ts`.
- `_shared/caller.ts`: `requireCaller` (the user comes only from the verified token, with a client that runs as them),
  `resolveCallerAccount` / `resolveCallerReadAccount` (a team account named in the request is used only after the membership check) and
  `assertOwned` (a row of another account answers like a missing one). **Every function a signed-in user calls identifies them with
  `requireCaller`**, except nine that keep their own check, each for a recorded reason (`OWN_CHECK` in
  `src/test/function-ownership.test.ts`): `agent-approval` and `delete-project` (verify the raw token with `getClaims`), `agent-runtime`
  and `control-engine` (also accept the server key for a named user), `control-test-suite` (passes the token on),
  `compile-agent-manifest`, `compile-website-manifest` and `analyze-inputs` (sign-in is optional in the try-before-signup flow) and
  `mcp` (generated bundle; every tool runs with the caller's own token). The test fails a function that is not on that list and does not
  use `requireCaller`, and one on the list that now does.
- Someone else's decision, approval, event, incident or agent now answers **404 "not found"**, not 403, so ids of other accounts can
  not be probed (`control-engine`, `agent-approval`, `control-incidents`). A team member who may see an incident but not act on it is
  still told 403.
- Every query by id with the full-access key on an owner table was reviewed (`function-ownership.test.ts` records why each group is
  safe) and the guard stops a new unreviewed one.

## Files

Files users attach are in the private `user-uploads` bucket, under their own folder (`<user id>/…`): only the owner can upload,
open, replace or delete them, and they are shared as signed links that expire. The site generator publishes only the user's own
files that a generated site places (a copy in `mission-assets/website-images/<site>/uploads/`); a link to another account's
file is never published. `mission-assets` (generated site images) is written by the server only, under the site's id: a public image address does not say
whose it is (sites generated before 2026-11-05 still have the owner's id in their image addresses; see below). `governance-backups` is private
(server only). See `docs/data-encryption.md`. Build check: `src/test/data-isolation.test.ts` ("uploads stay private").

Known limit: the 8 sites that existed before the folder change (32 image files) keep the owner's id in their public image addresses.
Moving them means copying each file and rewriting the address everywhere it is stored (pages, saved versions, shared copies); that is
a data change on live content and is left for an explicit decision.
