# Session and access isolation

General data security, task 5. One person's session, rules and results never appear in another person's context. This page adds
the last layer (the page and the running server instances) to what `docs/data-isolation.md` (row level security, the isolation
register, `requireCaller`, two-user checks) and `docs/cross-platform-boundary.md` (accounts, tools, credentials, run tokens) already
enforce in the database and the functions.

## The layers, from the data outward

| Layer | What keeps it apart | Where |
|---|---|---|
| Stored rows | row level security on every table; the isolation register lists who owns each (`isolation_report()` empty) | `docs/data-isolation.md` |
| Rules | loaded by account (`safety_rules.user_id`), narrowed to the API key or agent; the built-in rules are the only shared ones | `loadSafetyRules`, `loadRuleLines` |
| Results and caches | every cache row carries its account or API key and is read with it: generations, answers, replies to retried requests | `generation-cache.ts`, `response-cache.ts`, `idempotency.ts` |
| Outer Control runs | a tool, a credential, a Task, a step and an API key each belong to one account; a run is bound by a signed token | `docs/cross-platform-boundary.md` |
| A running server instance | no per-person variable survives between requests (below) | `src/test/session-isolation.test.ts` |
| Live updates | only the database's table-change feeds, each filtered to one account, user or agent, and checked by the person's own rights; no broadcast or presence channel | same test |
| The page | everything the previous session left is emptied when the session ends, when a different person signs in, and when the active account changes (below) | `src/lib/session-reset.ts` |
| The chosen account | the stored choice is accepted only if it is one of the signed-in person's own accounts | `resolveActiveAccountId` |

## The page is emptied when the session changes

The website is one page: signing out does not reload it. Without a reset, whatever the previous session loaded (the data cache, the
website preview, live channels, the tab's storage) would still be there when the next person signs in.

- **Signed out:** the data cache is cleared, live channels are removed, the preview cache and the tab's storage (approved replies,
  the account choice) are emptied.
- **A different person's session takes over** (including a sign-in made in another tab): their screens refetch from nothing, and
  the preview cache and tab storage are emptied. The same person's refreshes and repeated sign-in announcements change nothing.
- **The active account changes** (own account, or a team's): cached data and previews are dropped, so the new account's screens never
  show what was cached for the old one. The sign-in itself stays.

## No per-person state on the server

A function instance serves many people's requests one after another, so a module-level variable holding anything about a request would
be seen by the next one. The build lists every module-level variable in the functions that can change (`let`, or a map, a set, a list
or an object created empty and filled later) and fails on any that is not reviewed with the reason it holds nothing about a person.
Today there are nine, all of them one of: NazAI's own settings read once from the environment, a loaded model, the failure times of an
AI provider, or the list of destination addresses already checked as public (`egress.ts`).

## Limits

- One person's errors from an AI provider can pause calls to that provider for everyone for 30 seconds (`ai-gateway.ts`). That affects
  availability, never whose data is seen.
- The checked-destination list in the outbound guard (`egress.ts`) is shared by all requests in an instance for five minutes. It records
  that an address was public; it grants access to no data, and every customer address is still validated before it is stored or called.
- The sign-in session itself stays in the browser so a reload keeps the person signed in; it ends with sign-out, and the access token
  expires within an hour. Closing the browser without signing out leaves that session in place, as with any site.
- A person who is a member of two accounts sees both only by switching, and the switch empties what the other account cached. Two
  people looking at the same shared screen are not separated by this: that is what roles and permissions are for.

## Checks

- **Build** (`src/test/session-isolation.test.ts`):
  - signing out, another person signing in and switching accounts empty the caches (tested on a real data cache);
  - the reset is wired into the page and into the account switch, and there is only one data cache;
  - no unreviewed per-person state at module level in the functions, and no stale review entry;
  - no broadcast or presence channel; every table-change feed is filtered to one account, user or agent.
- **Database:** `select * from isolation_report();` and `select * from boundary_report();` are empty (checked on the live database
  when this was written).
