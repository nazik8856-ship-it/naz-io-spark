# Make Deploy actually produce a running autonomous Agent (not a second spec)

You're right — today both phases output text documents (plan, then a more detailed plan). To deliver "the AI Agent itself" as an autonomous software entity, the Deploy step has to compile the plan into a **structured manifest** and then **stand up a real runtime** that reasons, calls tools, makes decisions, and runs on a schedule.

## Two-phase split

**Phase 1 — Plan (unchanged):** `generate-ai-agent` produces the 8-section human-readable plan. User reviews it.

**Phase 2 — Build the Agent (new):** `Deploy AI Agent` no longer asks the model for another document. Instead it runs a 3-stage compile → instantiate → activate pipeline.

### Stage A: Compile manifest (structured, not prose)
- New edge function `compile-agent-manifest` calls the AI SDK with `Output.object` (Zod schema) to convert the plan into a strict JSON `AgentManifest`:
  ```ts
  {
    id, name, goal,
    systemPrompt,            // in-character operating prompt
    tools: [{ name, description, kind: "http"|"web_search"|"db_query"|"calc"|"notify"|"custom", config }],
    triggers: [{ kind: "cron"|"webhook"|"manual", spec }],
    decisionPolicy: string,  // when to act vs. ask
    guardrails: [{ rule, requiresApproval: boolean }],
    kpis: [{ name, target }]
  }
  ```
- No prose output. If the schema doesn't validate, retry once, then surface a real error.

### Stage B: Instantiate (persist + register tools)
- New table `agents` (id, user_id, manifest jsonb, status, created_at) + `agent_runs` (id, agent_id, trigger, started_at, finished_at, status, summary) + `agent_events` (id, run_id, kind: "reason"|"tool_call"|"decision"|"action"|"guardrail_block", payload jsonb, ts). Full RLS per user, GRANTs included.
- Save manifest. Assign a stable agent slug.

### Stage C: Activate the runtime
- New generic edge function `agent-runtime` (the actual agent loop, reused by every agent):
  - Loads manifest by id.
  - Uses AI SDK `streamText` with the manifest's `systemPrompt`, the goal as the user message, and a **real tool registry** built from `manifest.tools`.
  - `stopWhen: stepCountIs(50)`.
  - Tools mapped to real `execute` fns:
    - `http` — `fetch()` to a whitelisted URL (returns JSON/text).
    - `web_search` — Lovable AI web search.
    - `db_query` — read-only SELECT on this project's tables the user owns.
    - `calc` — math eval.
    - `notify` — writes an `agent_events` row (and later: email via Resend / webhook).
    - `custom` — if the tool needs an external API key the user hasn't added, mark it `needsApproval` and pause until configured.
  - Each step writes an `agent_events` row so the UI can show the reasoning chain in real time.
- Triggers:
  - `manual` — works immediately ("Run Now" button).
  - `cron` — register a pg_cron job that POSTs to `agent-runtime` on schedule.
  - `webhook` — agent exposes a unique POST URL.

### Stage D: Replace the preview card with the Agent Cockpit
Once Stage A-C succeed, the preview swaps from the spec doc to an **Agent Cockpit**:
- Header: agent name, status pill (`ACTIVE` / `IDLE` / `PAUSED`), next-scheduled-run countdown, manual **Run Now** button.
- **Live activity feed** (left, ~60%): streams `agent_events` in real time — "Reasoning…", "→ http GET …", "← 200 OK", "Decision: alert user (threshold exceeded)", "Action: notify". This is the proof it's an autonomous entity, not a chatbot.
- **Tools panel** (right): each tool with status (ready / needs-secret), config, last-call timestamp.
- **Guardrails panel**: shows rules, any approval requests queued for the user.
- **KPIs panel**: live counters.
- **Chat** moves to a secondary tab. The agent's primary mode is autonomous; chat is for ad-hoc instructions.
- Original plan + manifest JSON viewable in a "Blueprint" tab (collapsed by default).

## Honest constraints I want to flag before building

- **Real external integrations need real secrets.** If the plan says "Polls Stripe for refund anomalies," the agent can't poll Stripe until a Stripe key exists. The runtime will detect this, mark the tool as `needs-secret`, and prompt the user to add it (via the standard secret flow). Until then that specific tool is inert — but the rest of the agent runs.
- **`pg_cron` scheduling** requires the extension enabled in this project. If it's not, scheduled triggers fall back to "Run Now" + a UI nudge.
- **This is a big build.** Conservatively: 1 schema migration, 2 edge functions (`compile-agent-manifest`, `agent-runtime`), 1 cockpit React surface (~600 LOC), rewrite of the deploy handler in `GenerationWorkspace.tsx`. I'll keep the existing plan-card flow intact and only replace the post-deploy branch.

## Out of scope (call out if you want them added)

- Multi-agent orchestration (agents calling other agents).
- A visual tool-builder UI for the user to author custom tools.
- Long-term memory / vector store. Agent memory will be limited to recent `agent_events`.

## Answer to the underlying question

Yes — to make Deploy produce "the agent itself" rather than a second spec, NazAI has to stop generating prose at that stage and instead **compile a structured manifest, persist it, and boot a generic runtime that actually executes the loop**. The UI proof is the live activity feed showing real tool calls and decisions, not another document.

Want me to build this end-to-end as described, or trim it down (e.g., manifest + manual-run cockpit first, scheduling and webhooks later)?
