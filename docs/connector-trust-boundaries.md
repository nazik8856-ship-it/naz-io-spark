# Connector trust boundaries

General data security, task 4. A tool Outer Control connects (a customer's endpoint or an MCP server) is outside NazAI. It receives
only what its own step needs and can reach nothing else of NazAI's. Builds on `docs/cross-platform-boundary.md` (whose walls decide
which account's tool and credential a step may use) and `docs/data-in-transit.md` (where a request may go, and what is masked).
Nothing here warns and carries on: what a tool must not see is not sent.

## What a tool is sent

`supabase/functions/_shared/outer-control-share.ts` is the one place that says so; the session engine builds every request through it.

| Sent to an outside tool | Where it comes from |
|---|---|
| the step's objective, answer and correction | the step itself |
| the step's context | the Task's context for a first step; for a later step only what it **declares it depends on** (`depends_on`), and nothing when its hand-off is `none` (`outer-control-workflow.ts`) |
| accepted answers (`accepted`) | this step's own earlier exchanges |
| rules | the rules that apply to **this tool** |
| memory lines and the list of rules already triggered (`avoid`) | **this step's** memory only |
| session id and step number | opaque to the tool; they give it no access |

Not sent: what other tools in the Task did (their rejections, the rules their replies triggered, their memory lines), another
account's anything, the account, API key, Task, tool and vault-reference ids (masked out of the body, and out of the copy stored for the
step), NazAI's own credentials and sign-in tokens (`docs/data-in-transit.md`, `cross-platform-boundary.md` section 6), and any
field the request format does not define.

A Task's memory stays shared by its steps for **NazAI's own** decisions (the brain re-applies a rule pinned anywhere earlier);
only the view handed to an outside tool is cut.

## What stays inside NazAI

A NazAI agent, the report writer and a starter tool run inside NazAI for the same account and keep the full view; they are not
outside tools (`isExternalTool`).

## Fields are an allowlist

`BODY_FIELDS` lists the top-level fields of each request format (generic JSON, OpenAI chat, Anthropic messages). `confineBody`
drops anything else before the request leaves and names what it dropped. A field added to the request builder later is not sent
until it is added to the list on purpose (a code review, a test change).

## Credentials

A tool's key is sent only in its own authentication header, to its own address (a redirect is never followed, the address is
checked on every call, a key belongs to one account: `cross-platform-boundary.md` section 2). The body never carries it (masked).
Every call to an outside tool writes a signed evidence row first (`docs/security-evidence.md`).

## Checks

- **Engine** (`tests/outer-control-engine/session-test.mts`): a second tool's request holds none of the first tool's memory lines or
  triggered rules; a tool still sees its own earlier lines; the account id placed in a Task's context is gone from the body.
  (Verified to fail when the rule is removed.)
- **Unit** (`outer-control-share_test.ts`): which tools are outside; memory and `avoid` per step; the allowlist drops and names extra
  fields; today's real requests fit the allowlist exactly; which ids count.
- **Build** (`src/test/connector-trust.test.ts`): the engine builds requests through the share module, never from the whole Task's
  memory; hand-offs use `depends_on` only; every format has an allowlist.

## Limits

- A NazAI **agent** used as a tool runs with its account's connected data (Gmail, Notion, Shopify and the rest, per
  `agent_integrations`), as it does on its own schedule. Its actions go through Inner Control, and its input is limited after
  flagged content (`docs/external-content.md`), but Outer Control does not narrow which of the account's connections an
  agent may use for a step. Narrowing that per step would be a product change (choosing connections per Task); it is not done here.
- What a person puts in a Task's objective or context goes to the tools that Task uses. The boundary decides which **tool** gets
  which **step's** data; it does not judge whether the person meant to share it (the masking of secrets and the rules do).
- The context of a Task goes to every step that has no dependencies. Splitting it per tool needs the person to say which tool
  needs which part.
