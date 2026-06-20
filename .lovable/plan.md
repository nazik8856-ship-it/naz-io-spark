## Goal

The screenshot shows the post-deploy fallback card ("YOUR AI AGENT IS LIVE / Open Chat" + description) instead of the real Agent Cockpit. That means the deploy pipeline (compile manifest → persist agent row → start runtime → render cockpit) isn't completing — the message has `agentStatus: "approved"` but no `agentManifest` / `agentDbId`, so the UI silently falls back to the description doc.

This plan wires the post-deploy view to the **real** autonomous-agent pipeline so pressing Deploy actually produces a running agent and the preview swaps to the live Cockpit.

## What changes

### 1. Make the Deploy pipeline visible and verifiable

- In `GenerationWorkspace.tsx > buildAgent`: stop hiding failure modes. If `compile-agent-manifest` returns no `agentId` (not signed in, RLS denied, etc.), keep `agentStatus = "pending"`, show the inline error (`agentError`) on the spec card, and surface a Retry button. Today the toast fires once and the card silently slides into "approved" with no manifest.
- Add a small "Compiling manifest…" / "Booting runtime…" / "First run dispatched" sub-state in the deploy progress strip so the user sees the two real stages (manifest compile, runtime kick-off), not just a generic "compile --deploy" terminal.
- Log compile/runtime errors to console with the function name so they're visible in network panel debugging.

### 2. Render the real Cockpit whenever deploy succeeded

- Cockpit currently only renders when `agentManifest && agentDbId` both exist on the in-memory message. Two fixes:
  - **Auto-heal legacy approved messages**: on mount, for every message with `agentStatus = "approved"` missing `agentManifest`/`agentDbId`, call `compile-agent-manifest` once with `save: true` and patch the message. This fixes the user's current screenshot without them re-deploying.
  - **Persist agent linkage**: store `{ messageId → agentDbId }` in localStorage so reloads restore the Cockpit instead of dropping back to the fallback card.
- Remove the "Open Chat" fallback section from the approved branch — once a real agent exists, the Cockpit (with built-in chat tab) is the single source of truth. Keep "Open Chat" only as a button inside the Cockpit header.

### 3. Confirm the runtime actually runs

- `compile-agent-manifest`: re-verify it returns `{ manifest, agentId }` and that the `agents` insert uses the caller's `auth.uid()` (RLS). If not, switch it to read `Authorization: Bearer <user-jwt>` and create a per-request Supabase client so the row belongs to the user.
- `agent-runtime`: confirm it creates an `agent_runs` row and streams reasoning into `agent_events` in real time. Add a startup `reason` event ("Agent booted, planning first action…") so the Cockpit's Live Activity feed is never blank for new agents.
- Cockpit's polling: switch from interval polling to a Supabase realtime subscription on `agent_events` filtered by `run_id`, so reasoning steps appear instantly.

### 4. Cockpit UI polish for mobile (matches the screenshot's viewport) and don't forget about Form-Computer view

- Stack panels vertically below ~640px width; the current 2-column layout cuts off the activity feed on mobile.
- Header: agent name truncates to one line with full name in tooltip; status pill ("LIVE", "RUNNING", "IDLE"); a single primary "Run Now" button; secondary "Blueprint" and "Chat" buttons.
- Live Activity feed is the largest panel — render `reason`, `tool_call`, `tool_result`, `decision`, `action` events with distinct icons and a monospace timestamp.
- Tools panel: each tool with kind badge; tools flagged `needs-secret` show an "Add secret" CTA that opens the secrets flow for that key.
- KPIs panel: shows targets from the manifest with a "—" placeholder until the runtime emits a metric event.

### 5. Out of scope (call out, don't build)

- Real Stripe/Coinbase/exchange integrations for the crypto example agent — those need user-provided API keys. The agent will run with `web_search`, `http_get`, `calc`, `notify` only until secrets are added. The Cockpit will say so explicitly.
- Scheduled triggers (`cron`) — `pg_cron` extension setup deferred. UI shows "Manual" only for now.
- Multi-agent / long-term memory.

## Technical summary


| File                                                 | Change                                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/GenerationWorkspace.tsx`                  | Robust `buildAgent` error surfacing; auto-heal effect for legacy approved messages; persist `messageId → agentDbId`; remove "Open Chat" fallback section |
| `src/components/agents/AgentCockpit.tsx`             | Realtime subscription on `agent_events`; mobile-stacked layout; Tools/KPIs/Activity panels; needs-secret CTAs; embedded Chat tab                         |
| `supabase/functions/compile-agent-manifest/index.ts` | Verify auth-context insert into `agents`; clearer error JSON                                                                                             |
| `supabase/functions/agent-runtime/index.ts`          | Emit boot `reason` event; ensure `agent_runs` row created before tool loop; structured event payloads                                                    |


## Acceptance test

1. From a fresh plan, click Deploy.
2. Progress strip shows "Compiling manifest" → "Booting runtime" → "First run live".
3. Preview replaces the spec doc with the Cockpit: agent name + LIVE pill, "Run Now" button, Live Activity feed showing real reasoning steps streaming in within ~3s, Tools panel listing `web_search`/`http_get`/etc., KPIs panel, Blueprint tab still accessible.
4. Reload the page — Cockpit is restored, not the fallback card.
5. For an agent whose plan references an external service (e.g. Coinbase API), the relevant tool shows `needs-secret` with an "Add API key" CTA.