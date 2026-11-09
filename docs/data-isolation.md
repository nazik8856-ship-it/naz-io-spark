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
- **Cross-account stats** (`cross_account_precedent_stats`) show a row only once at least **5** accounts contributed (it was 2; with 2 contributors each could work out the other's numbers). The database rule, the server and the website use the same number, and a test keeps them equal. Before, only the
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
  `requireCaller`**, except eight that keep their own check, each for a recorded reason (`OWN_CHECK` in
  `src/test/function-ownership.test.ts`): `agent-approval` and `delete-project` (verify the raw token with `getClaims`), `agent-runtime`
  and `control-engine` (also accept the server key for a named user), `compile-agent-manifest`, `compile-website-manifest` and `analyze-inputs` (sign-in is optional in the try-before-signup flow) and
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
whose it is (pictures of sites generated before 2026-11-05 are moved out of the old per-owner folders; see below). `governance-backups` is private
(server only). See `docs/data-encryption.md`. Build check: `src/test/data-isolation.test.ts` ("uploads stay private").

**Files outlive nothing.** `site-images-cleanup-sweep` (daily, server key) removes the files of things that no longer exist: the public
pictures of a site that was deleted (both folder layouts, and the published copies of uploads), and a deleted account's private
`user-uploads` files. It leaves a folder alone while its site/account exists, while a page, a saved version or a shared copy still points
at it (`site_image_folder_in_use`), and while any file is newer than the grace period (1 day for pictures, 7 for private uploads); a lookup
that fails keeps the files and stops the run. At most 500 files per bucket per run; `{ "dry_run": true }` lists what it would remove.
Pause switch: `platform_settings.consequential_sweeps_paused`. Planning logic and tests: `_shared/orphan-files.ts`.

**Older sites' pictures move to the site's folder.** Sites generated before 2026-11-05 kept their pictures under
`website-images/<owner>/<site>/`, so their public image addresses showed the owner's account id (8 sites, 32 files on 2026-11-04). The
same daily sweep moves each such folder to `website-images/<site>/`, a few sites per run (`_shared/site-image-relocation.ts`):
1. the site must exist and belong to the account the folder is named after (otherwise the folder is left alone);
2. every file is copied to the new folder;
3. every stored address is rewritten in one transaction: pages, the site's prompt, shared copies and saved versions
   (`site_images_rewrite_refs`, server only, accepts nothing but that site's old folder and its new one);
4. the old files are removed only when `site_images_refs_count` finds no stored address left pointing at the old folder.

A failure stops before the next step, so no page ever points at a file that is gone; the next run picks the site up again. A copy of a
site saved outside NazAI before the move (a downloaded export) still points at the old addresses, which stop working once the old files
are removed.

## Front 4: connected tools and live updates

- **Connecting a tool belongs to the account that started it.** Each `*-oauth-start` stores a one-time state for the signed-in user
  (`requireCaller`); the public `*-oauth-callback` consumes it (single use, 10 minutes, server only) and takes the account from the
  state, never from the address. Gmail and Figma also sign the state (HMAC). Guards: `function-ownership.test.ts`.
- **The callback page** (`_shared/oauth-callback-page.ts`) escapes the title and message (a crafted `?error=` value used to be printed as raw
  HTML; the project domain serves it as plain text with a locked-down policy, so it was not exploitable there), keeps its script data safe
  (`</script>` in a value can not end the block) and posts its result only to our own app's origin when known. The website accepts that
  message only from our own backend's origin (`isTrustedOAuthOrigin`), so another window can not make a tool look connected.
- **Live updates:** four tables are pushed live (`agent_decisions`, `agent_events`, `agent_runs`, `outer_control_evaluations`), all owner/team
  tables with read rules; the app uses table changes only (no broadcast or presence). `isolation_report()` now flags `realtime_exposed` (a
  published table that is not owner/team/self/membership) and `realtime_broadcast_open` (an open rule on `realtime.messages`).
- Audited and found sound: outbound webhooks (account scope, https + public address check at creation and at every delivery, redirects not
  followed, signing secret shown once), the MCP bundle (every tool runs with the caller's own token), the public account search (fixed hosts,
  strictly checked store name, per-IP limit) and the website form endpoint (the owner comes from the site record).
- **A connection is finished only by the account that started it** (`_shared/oauth-completion.ts`, `20261106020000_oauth_peek.sql`,
  `src/pages/OAuthComplete.tsx`). The provider's redirect (GET) no longer finishes anything: the callback hands the browser back to the
  app's `/oauth/complete` page with the same parameters and uses nothing up. That page finishes the connection with a POST signed in as the
  person in that browser; the callback looks up who started the connection (`peek_oauth_transaction`, server only) and refuses with 403
  unless it is the same account, leaving the state unused. Nobody signed in gets 401, a failed lookup stops the request (503). Before this,
  someone could start a connection and get another person to approve it at the provider, and that person's Slack, Gmail, Notion, Canva,
  Figma or Shopify was attached to the starter's account. The rest of each callback is unchanged; the old result page is still the answer
  to a bare GET. Guards: `function-ownership.test.ts` (gate first, answers through `oauthResponse`), `oauth-completion_test.ts`,
  `oauth_peek_test.sql`, `src/test/oauth-complete.test.ts`.
  Rollback: re-pin the six `*-oauth-callback` functions to the commit before this change.

## Front 5: the two-user proof

- `supabase/tests/secrets/two_user_isolation_test.sql` (CI): for every registered owner/team/self table that exists, a row for A is created,
  then a stranger (B) and a team viewer (V) try to read, change, give away, delete and create rows for A; A is the control. Skipped tables are
  listed, never silently passed; the run fails on a leak or if too few tables could be tested.
- `supabase/tests/live/two_user_check.sql` (live, run by hand): the same questions on real rows, inside one statement that always ends in an
  error, so nothing is kept. 2026-11-01: 40 tables with rows, 360 questions, 0 leaks, the owner could read their own rows in all 40 (35
  registered tables had no rows yet).
- `supabase/tests/live/functions_refuse_strangers.sql` (live, run by hand): posts an empty body with only the public key to every user,
  API-key and scheduled function; every answer must be 400/401/403/404/405/429. 2026-11-01: 72 of 73 refused; `control-test-suite`
  answered 200 with 30 "not authenticated" scenario errors (no data, no action) and now checks the caller first. Left out on purpose: the
  public functions, `analyze-inputs`, `compile-agent-manifest`, `compile-website-manifest` (sign-in optional) and the generated `mcp` bundle.

The last layer, the page and the running server instances, is in `docs/session-isolation.md`.
