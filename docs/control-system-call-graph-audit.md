# Control System — Full Call-Graph Audit

Date: 2026-08-17
Scope: every place `control-engine`, `control-gate.ts`, `capability-registry.ts`, and
`provider-writes.ts` are imported or expected to be called, across
`supabase/functions/`. Method: direct code tracing (grep + read), not self-report.

This was requested as Claude Code Task 1 for the AI Control System — "confirm
(a) agent-runtime genuinely routes every tool call through control-engine/control-gate,
(b) no dead-code imports exist, (c) every real write in provider-writes.ts is
reachable — do not assume anything is wired just because it's imported."

## Summary

- (b) and (c) check out clean — no dead imports, no orphaned writes.
- (a) does **not** fully check out. `agent-runtime` routes most real tool calls
  through `control-engine`/`control-gate`, but the gate is scoped to an explicit
  allow-list (`ACTION_CAPPED_KINDS`) rather than "every real write action," and
  two genuinely real, verified write capabilities fall outside that list and so
  never reach the gate at all.
- A second, older approval/execution path (`agent_events` kind `pending_approval`
  → `agent-approval` edge function) is still live in the UI and bypasses
  `control-engine`/`control-gate` entirely at execution time, with no quorum
  enforcement — this sits alongside, not inside, the `pending_approvals` +
  quorum system that was just hardened this session.

## Confirmed working as documented

- **Gate ordering** in `_shared/control-gate.ts` matches the documented order
  exactly: spend cap + kill switch (steps 1–2, short-circuit together) → hard
  rules (step 3) → circuit breaker (step 4) → safety scanner (step 5). Verified
  by reading `runControlGate` top to bottom — the `killed || spend.over_cap`
  check returns before hard rules are even loaded from the pinned policy
  snapshot.
- **`control-system-decide` → `control-engine`**: the chat entry point hands
  off *every* extracted action to `control-engine` unconditionally (no
  allow-list), so the chat path does not have the gap described below.
- **Multi-approver quorum** (previously an open item in the task list) is now
  genuinely implemented, not just cosmetic:
  - `pending_approvals.approvals` is a distinct-signoff log, only mutable
    through `record_approval_signoff()` (SQL migration
    `20260817015635_c065398c...`), which is the only path that can flip a row
    to `approved` — a DB trigger (`guard_pending_approval_update_trg`) raises
    an exception if a client tries to write `status`/`approvals`/
    `required_approvals` directly.
  - `control-engine`'s `/approvals/:id/execute` re-derives the distinct
    approval count from the stored log and refuses (409 `quorum_not_met`) if
    it's short of `required_approvals`, even if `status` were somehow
    `approved`.
  - `ControlApprovals.tsx` calls the RPC and shows a live "N of M sign-offs"
    count.
  - This satisfies Task 2's stated test intent (1-of-2 must still block, 2-of-2
    must allow) at the code level — I did not run it against a live DB, so
    treat this as **traced, not executed**.
- **`injection-scanner.ts`** is genuinely wired into `control-engine` (collected
  → scanned → delimited → forces block/deferred), matching the claimed fix.
  Not dead code.
- **`provider-writes.ts` reachability**: `PROVIDER_WRITE_KINDS` (16 kinds) and
  the `runProviderWrite` switch statement are 1:1 — every kind in the set has a
  case, every case is a real exported function, nothing orphaned. Both callers
  (`agent-runtime`'s tool dispatch and `control-engine`'s `/approvals/execute`
  and allow-branch) use the same shared set, so there's no drift between what
  the two entry points consider a "real write."

## Gap 1 — `ACTION_CAPPED_KINDS` is not "every real write action"

`agent-runtime/index.ts` only calls `assessWithControlEngine()` (the function
that reaches `control-engine`, with a local `runControlGate` fallback if the
HTTP call fails) when `ACTION_CAPPED_KINDS.has(tool.kind)`
(`agent-runtime/index.ts:1469`). That set has 16 entries — the provider writes
plus `upsert_client_note`.

Cross-referencing against `capability-registry.ts`, two capabilities are
`implemented: true, verified: true, mode: "write"` but **not** in
`ACTION_CAPPED_KINDS`:

| kind | what it actually does | gap |
|---|---|---|
| `http_post` | POSTs an arbitrary JSON body to any public HTTPS host (SSRF-protected — private/loopback IPs are blocked in `validateHttpPostUrl`, `agent-runtime/index.ts:3131`) | Never reaches `control-engine`/`control-gate`. No kill-switch check, no hard-rule check, no circuit breaker, **no PII/secrets/destructive-action safety scan of the outgoing body**, no signed `agent_decisions` receipt. Gating is entirely local: a per-agent manifest guardrail (approval-required by default) plus the SSRF IP check. If the org's kill switch is flipped on, an agent can still POST data to an external endpoint through this tool. |
| `schedule_followup` | Inserts a new `agent_runs` row that will execute up to 90 days in the future | Same: no kill-switch/hard-rule/circuit-breaker check. Since it's a write that schedules future autonomous executions, a kill-switched org's agents can still queue work that runs once the switch is off — nothing revalidates the queued run against policy at creation time (execution time does go through the normal per-tool gate, since it's a fresh run, but the write in `agent_events`/`agent_runs`/self-perpetuation is itself unpoliced). |

By contrast, `generate_report` and `remember` are also outside
`ACTION_CAPPED_KINDS`, but they're internal-only (NazAI's own DB), lower
severity — I'm not flagging those as equivalent risk, just noting them for
completeness.

**Fix shape** (not implemented — audit only): add `http_post` and
`schedule_followup` to `ACTION_CAPPED_KINDS`, or add a second, smaller
allow-list specifically for "everything `capability-registry.ts` marks
`mode: write` and `verified: true`" so the two lists can't drift again. The
safety scanner in particular should see the outgoing `http_post` body before
it leaves — that's exactly the PII/secrets exfiltration case it exists for.

## Gap 2 — a second, unguarded approval/execution path is still live

**Update (Task 2, same day): partially fixed.** `agent-approval` now re-runs
`runControlGate` immediately before dispatching an approved `send_email` or
`http_post`, so a kill switch / hard rule / circuit breaker / safety-scanner
condition that changed while the item sat in the queue still stops it — see
`supabase/functions/agent-approval/index.ts:77-108`. What's still true and
intentionally not changed: this queue has no quorum concept (`required_approvals`
doesn't exist on `agent_events`) — it remains a single-operator, per-agent
manifest-guardrail queue, structurally distinct from the org-wide
`pending_approvals` quorum system. Treat that as a known, accepted design
difference, not an oversight — see the original description below for why it
was flagged.

There are **two independent** "queue for a human, then execute" systems in
the codebase, not one:

1. `pending_approvals` table + `control-engine` gate + `record_approval_signoff`
   RPC + quorum (described above — this is the hardened one).
2. `agent_events` rows of kind `pending_approval`, created in several places
   inside `agent-runtime` (`upsertClient`'s own approval branch, the
   `request_approval` tool, the `send_email`/`http_post` per-agent manifest
   guardrail branches), resolved by the **`agent-approval`** edge function.

`agent-approval/index.ts` is not dead code — `AgentEmployeePanel.tsx:105`
calls it directly from the live per-agent operator panel
(`respondApproval()`), so this is an actively used, user-facing path.

Tracing what happens on approval:

- For `send_email`: it calls `send-transactional-email` directly with a
  generic template — **not** the same Gmail-send-then-verify path
  `agent-runtime` uses for a directly-allowed `send_email`
  (`agent-runtime/index.ts:1811-1840`). No re-fetch/verification step.
- For `http_post`: it does its own inline `fetch()` — no SSRF/IP check (unlike
  `validateHttpPostUrl`), no control-gate call.
- Neither branch re-checks kill switch, hard rules, circuit breaker, or the
  safety scanner at approval time. A kill switch flipped on *after* the item
  was queued does not stop it from executing when approved.
- There is **no quorum concept here at all** — a single `action: "approve"`
  call executes immediately. `required_approvals` (the field the quorum system
  reads) doesn't exist on `agent_events`; it's a `pending_approvals`-table-only
  concept. So the multi-approver enforcement shipped this session does not
  cover everything a human can approve in the product today — only the
  control-engine-originated queue, not the manifest-guardrail queue.

This is the same class of issue the prior sessions caught with the dead
injection-scanner and the fake `notify` tool: something that looks wired
(there's a real approval flow, it really executes real actions) but sits
outside the safety layer the rest of the system was built around.

**Fix shape** (not implemented — audit only): either retire
`agent-approval`/the `agent_events` `pending_approval` flow in favor of
routing those same triggers into `pending_approvals` via
`createPendingApproval()` (so they get quorum + a real gate re-check at
execute time), or explicitly re-run `runControlGate` inside `agent-approval`
before dispatching, and add a `required_approvals` concept to that queue too.
Given there are now two queues with materially different guarantees, the
UI arguably should not present them as equivalent "approve/reject" actions
without saying which safety net backs each one.

## Minor note — internal client-record writes bypass the gate too

`upsertClient()` is called both directly (as the `upsert_client_note` tool,
which *is* gated) and indirectly as a side effect after a successful
`send_email`/`reply_email` (`agent-runtime/index.ts:1863`, `:2466`). The
indirect call never passes through `control-engine`/`control-gate` — it only
checks the agent's local `client_write_mode` setting. Low severity (internal
DB write, not an external effect), but it means "every real write action is
gated" isn't quite true even for a capability that itself has a gated entry
point, depending on which code path triggers it. Noting for completeness, not
recommending immediate action.

## What I did not verify

- **Update (Task 2, same day):** the quorum-check logic was extracted into
  `_shared/quorum.ts` (`checkApprovalQuorum`) and `control-engine`'s execute
  endpoint now calls it directly — so the function under test is the exact
  function production code runs, not a parallel copy. Real, executed
  `deno test` cases now cover 1-of-2 blocks, 2-of-2 allows, duplicate
  approver dedup, rejected-status precedence, and edge cases (0/negative
  `required_approvals`, malformed `approvals`); all 10 pass — see
  `supabase/functions/_shared/quorum_test.ts`. I still did not run this
  against a live Postgres `record_approval_signoff()` RPC (no reachable
  Supabase project in this session — the linked project came back
  `INACTIVE` and its ref doesn't match the `qaeduinfirtljnbecyzq` host cited
  as production, so I didn't touch it) — that RPC's SQL logic is unit-tested
  only in the sense that its JS-side counterpart is proven correct; the SQL
  trigger/RPC itself should still get a live pass before being trusted blind.
- I did not re-audit `control-test-suite`, the anomaly-detection item, the
  scheduled self-audit item, or the capability-visibility endpoint — those are
  separate open Task-list items (3, 4, 5) and out of scope for this call-graph
  audit.
