# Outer Control: tool addresses and connection failures

## What is an outside tool

An outside tool is a service somewhere else with an HTTPS address and (usually) a key. **NazAI's own projects are not outside tools**: its server, its website (`nazai.net` and every name under it), and the agents and sites built on it. Aimed at them, a request would be NazAI talking to itself. They are connected the NazAI way: **Connect a tool → Your NazAI agents → Add** (or, in a workflow, Add agent) needs no address and no key. With no agent yet the section says so and links to creating one (`create_agent_tool`, endpoint `nazai-agent://<id>`).

| Kind | Endpoint | Treated as |
|---|---|---|
| Outside tool | `https://…` | tested over the network, needs a key, first contact approved by the owner, re-tested every 12 h (keep-alive) |
| NazAI agent | `nazai-agent://<agent id>` (and `agent_id` set) | run inside NazAI; shown as **Built in**; its test only checks the agent still exists; no key to update |
| Report writer, starter AI | `nazai-internal://…` | run inside NazAI; Built in |

## Where the rule is applied (`supabase/functions/_shared/outer-control-address.ts`, mirrored for the form in `src/lib/outer-control-tools-ui.ts`)

1. **The Connect form** shows the problem before anything is sent.
2. **`create_tool`** refuses the address with `address_is_nazai` and says where to go instead.
3. **The connection test** reports it without sending a request.
4. **A Task step** stops with the same message if a tool saved before this rule has such an address.
5. NazAI's own server address was already refused by the general address check (`ownProjectProblem`); the website name is new.

Existing tools with such an address are not deleted; they show Failed with the message, and the owner removes them. The keep-alive already left agents and `nazai-internal://` tools out (it only tests tools with no `agent_id` and not `nazai-internal://`).

## Failure reasons

| What happened | What the person reads |
|---|---|
| name does not exist (DNS) | "The address could not be found … Check the address for a typo." |
| certificate not valid | "The tool's security certificate is not valid …" — not retried during a Task (it will not fix itself) |
| connection refused | "The tool's server refused the connection. It may be down, or the address or port is wrong." |
| connection cut off | "The connection to the tool was cut off while it was answering." |
| no answer in time | "The tool did not answer in time." |
| HTTP 400/422 | request format and model name |
| HTTP 401/403 | the key was rejected |
| HTTP 402 | no credit / unpaid plan at the provider |
| HTTP 404/410 | nothing answers at that address |
| HTTP 413/415 | too large / format not accepted |
| anything else unreadable | "The tool could not be reached." |

`networkFailureKind()` (`_shared/network-failure.ts`) reads the error and never repeats its raw text, so addresses, ports and system messages do not reach the screen.

## Checks

`src/test/outer-control-address.test.ts` (the rule, the form agreeing with the server, the real server host, built-in health, every failure kind, retry behaviour), `src/test/active-sessions-card.test.tsx` (an agent row), `supabase/functions/_shared/network-failure_test.ts` (Deno).

## Keep-alive audit (2026-11-13)

Question: does the 12-hour keep-alive test NazAI's own projects as if they were outside tools? **No.** Its query leaves out every tool with an `agent_id`, every `nazai-internal://` tool, and removed, disabled and never-approved tools. Live data agrees: the account has no `nazai-agent://` rows; the report writer and starter tools are `nazai-internal://`. One old test tool ("Bot2") pointed at NazAI's own server; its test already stopped before any request (the general address check), and now also says where to go instead. Pinned by a test in `src/test/outer-control-address.test.ts`.
