## What is blocking the current flow

The screenshot is stuck because the UI is marking an agent plan as `approved` before there is a real deployed agent behind it.

Current hurdle:

- The first phase succeeds: NazAI generates a written AI Agent plan/spec.
- The second phase is not reliably executed: compiling that plan into a saved runtime manifest and starting `agent-runtime`.
- The UI then shows `LIVE AGENT` / `Deployed` even when `agentManifest` and `agentDbId` are missing, so the Cockpit cannot render.
- Backend inspection shows `agents`, `agent_runs`, and `agent_events` are empty, and there are no recent calls/logs for `compile-agent-manifest` or `agent-runtime`. That means the real runtime path never completed for the shown deployment.
- A likely root cause is auth/header mismatch: the client calls edge functions with the anon key as `Authorization`, not the signed-in user's access token, while the functions require a real user to persist the agent row. When persistence fails, the UI can still get stuck in the booting fallback.

## Plan

### 1. Enforce a true two-phase state machine

Replace the current ambiguous `approved/building` flow with explicit states:

```text
plan_generating -> plan_ready -> compiling_manifest -> persisting_agent -> starting_runtime -> live
                                                   \-> failed
```

User-facing meaning:

- `plan_ready`: NazAI produced the agent blueprint only.
- `compiling_manifest`: converting the blueprint into executable configuration.
- `persisting_agent`: saving the agent as a real backend entity.
- `starting_runtime`: launching the first autonomous run.
- `live`: only after a real `agentId` exists and the runtime was triggered.
- `failed`: show the exact deploy hurdle and a retry button.

### 2. Stop showing “Deployed” before a real agent exists

In `GenerationWorkspace.tsx`:

- Do not set `agentStatus: "approved"` after plan streaming finishes.
- Set it to a plan-ready/pending state until the user presses `Deploy AI Agent`.
- Only show `Deployed` / `LIVE AGENT` after both are present:
  - `agentDbId`
  - `agentManifest`
- If either is missing, show `Deploy failed` or `Deploy incomplete`, not an infinite booting panel.

### 3. Fix authenticated deployment calls

In the client function-call helper:

- Use the current signed-in session access token for `Authorization`.
- Keep the anon/publishable key only as `apikey`.
- If no signed-in session exists, block deploy and show: `Sign in to deploy a real autonomous agent.`

This allows `compile-agent-manifest` to insert into `agents` under the user's identity and lets `agent-runtime` create `agent_runs` / `agent_events` under the same user.

### 4. Make deploy failures visible instead of silent

In `buildAgent`:

- Log and display which phase failed:
  - manifest compile failed
  - agent persistence failed
  - runtime start failed
- Keep the plan editable and retryable.
- Remove the indefinite `Booting autonomous runtime…` fallback after a short timeout.
- Add a “Retry deploy” button that re-runs only the deployment phase, not the whole plan generation.

### 5. Make runtime start verifiable

In `agent-runtime`:

- Return structured errors with the phase that failed.
- Ensure the first created event is immediate:
  - `run_started`
  - `reason: Agent booted...`
- If the AI loop later fails, still update the run with `failed` and emit an `error` event, so the Cockpit has something real to show.

### 6. Make the Cockpit the only success screen

In `AgentCockpit.tsx` / preview rendering:

- Render the Cockpit only for persisted agents.
- Show latest run status from `agent_runs` and live `agent_events`.
- If there are no events after startup, show a runtime error/empty state with `Run Now`, not a fake live card.

### 7. Clarify what “ AI Agent” means in NazAI

I've mentioned in the previous messages what AI Agent in our situation is.

The deployed agent will be represented as:

- A persistent `agents` row with a strict executable manifest.
- A runtime loop that can reason, use tools, make decisions, and execute multi-step workflows.
- Event logs proving what it thought, which tools it used, what it decided, and where it stopped.
- Guardrails that block external mutations/spending/messages unless approval or secrets are configured.

Initial real tools available:

- `web_search`
- `http_get`
- `calc`
- `notify` / logged action

External SaaS actions such as Coinbase, Stripe, Slack, or payments will be marked as `needs secret` until the user adds the relevant API key or connector. That is still a real deploy, but those specific tools remain inert until configured.

## Files to update

- `src/pages/GenerationWorkspace.tsx`
  - authenticated function headers
  - explicit deployment phases
  - no premature `approved` status
  - visible deploy errors and retry
- `src/components/agents/AgentCockpit.tsx`
  - stronger empty/error states
  - latest run status visibility
- `supabase/functions/compile-agent-manifest/index.ts`
  - return clear `401` when no real user token is present
  - return insert/RLS errors instead of silently returning `agentId: null`
- `supabase/functions/agent-runtime/index.ts`
  - structured runtime errors
  - mark failed runs as failed
  - always emit initial runtime events when a run is created

## Acceptance test

1. Generate an AI Agent plan.
2. The card says plan ready, not live.
3. Tap `Deploy AI Agent`.
4. UI shows each deploy phase.
5. If auth or persistence fails, the exact error appears and the button becomes `Retry deploy`.
6. On success, the preview switches to Agent Cockpit.
7. Database contains one agent, at least one run, and boot/reason events.
8. The Cockpit shows actual events instead of the infinite booting screen.
9. Reloading restores the real Cockpit only if the saved `agentId` is valid.