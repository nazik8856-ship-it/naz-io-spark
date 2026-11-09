# Cross-platform boundary control

General data security, task 4. Builds on user and data isolation (`docs/data-isolation.md`: row level security, the isolation
register, `requireCaller`, the two-user checks), secrets handling (the vault), data in transit (`docs/data-in-transit.md`) and data
at rest (`docs/data-encryption.md`).

Outer Control moves an account's content between NazAI and the tools that account connected: external tools, MCP servers and
the account's own NazAI agents. Content, credentials and results must never cross into another account, another Task or another
step. Nothing here warns and carries on: a crossing is refused.

## 1. A tool is loaded only for the account that owns it

- **In the code:** `resolveSessionTool(admin, session)` (`supabase/functions/_shared/outer-control-boundary.ts`) loads a step's
  tool only when it belongs to the step's own account and has not been removed. The session engine uses it everywhere it loads a
  tool (running a step, a person's edited reply, releasing an approved reply). `accountTools(admin, account, ids, cols)` does the
  same for lists (the tool names in a Task's report and hand-offs). Starting a Task already refused another account's tool; a
  key polling a Task already got "not found" for another account's or another key's Task.
- **In the database:** a write that makes a row point at another account's row is refused, from any path, the server's included.
  `boundary_references` lists each reference, and the trigger `<table>_same_account` (`enforce_same_account()`) checks it:

  | Row | Must belong to the same account |
  |---|---|
  | a step (`outer_control_sessions`) | its tool, its fallback tool, its Task, its API key |
  | a Task (`outer_control_workflows`) | its imported project, its API key |
  | an agent tool (`external_tools`) | the agent behind it |
  | a step's calls, memory, completion checks, corrections (`outer_control_session_steps`, `_memory`, `_completion_checks`, `_corrections`) | the step (and the Task) they belong to |
  | a hand-off (`outer_control_task_handoffs`) | its Task |
  | a project rule or meaning rule | its project |

## 2. A credential belongs to one account

A vault secret (a tool's key, an integration's tokens, a webhook, callback or agent signing secret) belongs to the account that
first stored a reference to it (`vault_secret_owners`). A row of any other account that points at it is refused
(`claim_vault_secret()`, on `external_tools`, `agent_integrations`, `agents`, `api_keys` and `webhooks`), so a credential can not
be borrowed by copying its id. Within one account, tools may still share a key.

## 3. A run on one of the account's agents is bound to it

When a Task's step is one of the account's own NazAI agents, Outer Control runs it through `agent-runtime` with the platform key.
The run now also carries a signed token (`x-outer-control-token`) that names the account, the Task, the step and the agent, and
expires after 15 minutes. `agent-runtime` refuses an Outer Control run whose token is missing, expired, changed, signed with
another key, or names anything else (another account, Task, step or agent), before the agent runs (`run_not_bound`, 403).

The token is signed with its own key derived from `DATA_KEY` ("nazai signed token v1"), never with the key behind content
fingerprints: an owner can see a keyed fingerprint of text they wrote, so that key must never sign anything.

## 4. Project context stays inside the account

A Task's project context is loaded only for a project of the same account (`projectContextFor`), and the database refuses a Task
that points at another account's project (section 1). The project's rules apply to that Task's steps only.

## 5. A customer's address is never NazAI itself

A tool, webhook, callback or page to import that points at NazAI's own project (`SUPABASE_URL`) is refused by `validateOutboundUrl`
when it is stored and again on every call, and a redirect to it is refused at the hop (`customerFetch`, `fetchPublicHttps`).
Without this, a request aimed at NazAI would be classed as NazAI talking to itself (no customer-origin check, no credential check),
and a tool's reply could drive NazAI's own functions.

## 6. A sign-in token never leaves for an outside host

The request guard (`outbound-guard.ts`) refuses any request to a host other than NazAI's own project whose address, headers or
body carry a token NazAI's auth issued: role `authenticated`, `service_role` or `supabase_admin`, or a session id. It is judged by
what the token says, not by its shape: NazAI's own file links (a storage signature with a `url` claim and no role) are meant to be
shared and pass, and so does the public `anon` key. A refusal is recorded as `outbound_blocked` evidence (credential
`SESSION_TOKEN`), never with the value. This covers a person's session forwarded by mistake, in any function, including one added later.

## Checks

- **Build** (`src/test/cross-platform-boundary.test.ts`):
  - no Outer Control code queries `external_tools` without naming the account, except the reviewed few (each with why: the keepalive
    sweep, a tool's own test result, the shared-key count);
  - the session engine resolves its tool through `resolveSessionTool`; every agent run sends the token; `agent-runtime` checks it
    before it loads the agent; the token key is separate from the fingerprint key;
  - the migration registers every reference and every vault column;
  - (`src/test/connector-trust.test.ts`) the own-project refusal and the sign-in token refusal are still in place.
- **Engine** (`tests/outer-control-engine/session-test.mts`, plain and through the encryption wrapper):
  - a step whose tool belongs to another account (or was removed) never calls it;
  - another account can not start a Task on this account's tool, nor read this account's Task;
  - an agent run carries a token for exactly its account, Task, step and agent;
  - the token fails for any other account, Task, step or agent, after 15 minutes, with another key, with a changed claim, and with a
    content fingerprint in place of its signature.
- **Unit** (`url-safety_test.ts`, `outbound-guard_test.ts`): NazAI's own project (any case, trailing dot) is refused as a tool address;
  a sign-in token, a service key and a session id are refused in an address, a header and a body; file links and the anon key pass.
- **Database:** `select * from boundary_report();` lists any row that points across accounts (`crosses_accounts`), any vault secret
  referenced by two accounts (`secret_shared`), and any registered reference without its trigger (`unenforced`).
- **Every Monday (03:53 UTC):** `boundary_weekly_check()` opens the platform incident `cross_platform_boundary` while the report has
  anything, and closes it once it is empty.
