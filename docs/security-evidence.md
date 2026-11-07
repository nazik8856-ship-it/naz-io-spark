# Security evidence for critical actions

General data security, task 6. A signed, append-only record of every critical action, kept per account, that can be checked later
without trusting the code that wrote it.

## What a row holds

Ids and SHA-256 hashes only, never content (class OPERATIONAL in `docs/data-classification.md`):

| Field | Meaning |
|---|---|
| `kind` | connector_call, credential_change, rule_applied, output_stored, content_held, outbound_blocked |
| `actor`, `actor_id` | user, api_key, agent or system, and its id |
| `subject` | what the action touched, by id (tool, Task, step, agent, run, table and row). Only short scalar values are accepted (checked by the database) |
| `input_sha256`, `output_sha256` | the hash of what went in (the request sent, the reply received) and what came out (the text passed on or stored) |
| `rule_ids`, `rules_sha256` | the rules that matched, and one hash of the whole rule set in force (ids and versions) |
| `verdict` | allowed, allow, modify, block, escalate, held, stored, refused, insert, update, delete |
| `seq`, `prev_hash`, `row_hash`, `signature` | the row's place in the account's chain, the hash of the row before it, its own hash, and an HMAC-SHA256 of that hash with the evidence key |

## How it is written

- **Only through `record_evidence()`.** It is a database function the server may call. Nobody can insert, update or delete rows
  directly: not the browser and not the server's own key. The function:
  - takes a per-account lock, so the chain never forks;
  - computes the row hash over a fixed canonical form;
  - signs it with `security_evidence_key`. That is a random 32-byte key made inside the database, kept in the vault and never
    shown.
- **Append-only.** A trigger refuses every update, delete and truncate. The one exception is deleting the rows of an account that
  no longer exists, which the weekly check does. `security_evidence_heads` keeps the last row of each chain, so removing rows from
  the end is noticed too.
- **The owner can read their rows** (row level security) and export them. Under Control System, open Pending approvals and choose
  "Export security evidence (CSV)". The export runs `my_evidence_check()` and says whether the chain is intact.

## What is recorded, and where

| Kind | Where | No row, no action? |
|---|---|---|
| connector_call | `runProviderWrite` (every provider write: agent-runtime, approvals, control-engine, the Control API); agent-runtime after its gates for every gated action; Outer Control before calling a tool outside NazAI (HTTP and MCP) | **Yes.** The call is not made and the reason says so. |
| credential_change | database triggers on `external_tools`, `agent_integrations`, `agents`, `api_keys` and `webhooks`: a credential reference added, replaced, revoked or removed, from any path | **Yes.** The change fails with the row. |
| rule_applied | Outer Control, for every judged reply: matched rule ids, the rule-set hash, the verdict | no (the check already happened) |
| output_stored | Outer Control, when a step's controlled result is stored as its final output | no |
| content_held | Outer Control, agent-runtime and the relay, when unsafe outside content is held (`docs/external-content.md`) | no |
| outbound_blocked | where an outbound-guard refusal meets an account (a step's tool call, an agent's tool) | the request was already refused |

A NazAI agent's own actions are recorded by agent-runtime, not by the Outer Control step that started the run. The report writer and
the starter tools are NazAI's own and are not connector calls. A tool's connection test sends a fixed test message and is not recorded.

## Checking it

- `select * from verify_evidence_chain();` (whole platform), or with an account id and a time range. For every row it recomputes the
  hash, the link to the row before it and the signature. It names each problem: `gap`, `broken_link`, `hash_mismatch`,
  `signature_mismatch`, `missing_rows` (the end of a chain was removed) or `key_missing`. Empty means intact.
- **Every Monday (04:41 UTC):** `security_evidence_weekly_check()` removes the rows of deleted accounts, then verifies every chain.
  It opens the platform incident `security_evidence` while anything fails, and closes it once all chains verify. Its result also
  counts the rows of each kind written in the last 7 days.

## Limits

- **Who the guarantee covers.** The chain proves that rows were not changed after they were written, by anyone without the database
  owner's rights. Someone with full database control (the platform's own operators) could rebuild a chain. Detecting that would need
  an outside anchor, such as a published head hash, which this baseline does not have.
- **The key is never rotated in place.** Rotating it means signing a new chain from that point. That is not built yet, because
  nothing needs it today.
