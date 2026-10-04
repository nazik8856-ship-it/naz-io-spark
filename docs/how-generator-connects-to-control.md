# How Generator, Inner Control, and Outer Control actually connect

Date: 2026-10-04
Scope: plain-language map of the three pieces of the core blueprint and the
real, verified seams between them — written because the connection, while
genuinely wired, was never visibly demonstrated, which made it easy to
mistake for missing. Every claim below was confirmed by reading the actual
code and/or querying the live database, not inferred from file names.

## The three pieces

- **Generator** (`GeneratorHome.tsx`, `compile-agent-manifest`,
  `GeneratedDashboard.tsx`) — where a user describes an agent or a website in
  plain language and NazAI builds it. An agent created here becomes a row in
  the `agents` table.
- **Inner Control System** (`/control-system` and its sub-pages) — the
  dashboard that shows every decision, rule, incident, and spend number for
  this account. It doesn't generate anything itself; it's a window onto rows
  other systems write.
- **Outer Control** (`/control-system/api-keys`, the public Control API) —
  lets an **external** AI system (not built in Generator at all) submit its
  own proposed actions to NazAI's gate and get back a verdict. Authenticated
  by a row in the `api_keys` table.

## The one function that actually governs everything

Every real action — whether it comes from a Generator agent's autonomous run,
a chat message to the Inner Control System itself, or an external system's
Outer Control API call — is evaluated by the same function:
`runControlGate()` in `supabase/functions/_shared/control-gate.ts`. Five
different edge functions call it (`control-engine`, `agent-approval`,
`outer-control`, `control-api`, and `agent-runtime` as a same-process
fallback if `control-engine` is unreachable) — one shared implementation, not
four parallel copies that could silently drift apart.

That function checks, in order: kill switch → spend cap → hard rules →
circuit breakers → safety scanner. Whatever wrote the row — agent, key, or
chat — gets the same checks, in the same order, against the same rules.

## How a new agent inherits rules automatically

`hard_rules` and `safety_rules` rows have a nullable `agent_id` column. A row
with `agent_id = NULL` applies account-wide; a row with `agent_id` set
applies only to that one agent. `selectRulesForAgent()` in
`src/lib/agent-policy.ts` (reused by `_shared/rule-matching.ts` on the
backend) returns an agent's own rules **unioned with every account-wide
rule** — so the moment a new agent exists, it is already subject to
everything the account has configured. There is no "turn on governance for
this agent" step to forget.

`compile-agent-manifest` goes one step further: it checks a new agent's
proposed manifest against the account's existing `hard_rules`/`safety_rules`
**before saving it**, stripping any tool an `always_block` rule would kill
and scanning the generated system prompt for anything a safety rule would
flag.

## Why Generator agents and Outer Control keys are two separate things

This is deliberate, not an oversight: `agents` (Generator) and `api_keys`
(Outer Control) are two different tables, visually distinguished in the UI
on purpose (see the comment block at the top of `OuterControlSystem.tsx`) —
one is an AI you built here, the other is an external AI you're choosing to
govern. An API key currently has no per-key rule override the way an agent
does (`hard_rules`/`safety_rules` only scope by `agent_id`); every key is
governed by exactly the account-wide rule set.

Both still write into the same `agent_decisions` table — an agent's rows
have `agent_id` set, a key's rows have `api_key_id` set, and a chat message's
rows have neither — and both show up in the same Live Activity and Decision
History feeds. `/control-system/entities` (added alongside this doc) is the
one screen that lists agents and keys together, with live counts proving
decisions are actually flowing from all three sources.

## What this does **not** mean

This document describes the wiring, not usage. As of this writing, the live
database for this account has real Outer Control traffic (through API
keys) and real chat traffic, but **zero Generator agents have ever actually
been created and run** — the pipeline is connected, but that specific path
has never been exercised end-to-end with real data. Seeing an agent's
actions actually appear in Inner Control requires creating and running one;
code review alone can't substitute for that.
