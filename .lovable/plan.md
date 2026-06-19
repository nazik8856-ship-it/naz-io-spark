# Show the Generated AI Agent in Preview after Deploy

Right now: pressing **Deploy AI Agent** streams the compiled spec into the same card that earlier held the plan, and the header still reads "AI Agent Planned!" even after deployment. The content does update to the deployed manifest, but visually it looks identical to the plan, so it doesn't feel like "the AI Agent appeared".

This plan makes the three phases visually distinct, so the user clearly sees: **Plan → Generation Process → Generated AI Agent**.

## What changes

All edits happen in `src/pages/GenerationWorkspace.tsx` (the unified agent card around lines 1458–1740). No backend/system-prompt changes — NazAI already knows how to compile the deployed agent (confirmed in `run-ai-agent` build mode).

### 1. Phase: Plan (status = `pending`)

- Header label stays **"AI Agent Plan Ready"** (purple accent).
- Buttons: `Generate` (regenerate plan) + `Deploy AI Agent` (primary).
- Card title prefix: small chip "PLAN".

### 2. Phase: Generation Process (status = `building`)

Replace the spec body with a dedicated **Generation Console** while streaming, so the user actually sees the agent being built instead of plan text mutating in place:

- Header label: **"Generating AI Agent…"** with animated cyan dot.
- Top of card: live progress strip with 4 ordered checkpoints that light up as the stream progresses (detected by which `**Section**:` headings have appeared in `acc` so far):
  1. Compiling identity
  2. Wiring triggers & tools
  3. Defining autonomous loop
  4. Setting guardrails & KPIs
- Below: terminal-style streaming pane that renders the incoming tokens as monospace text with a blinking caret (uses the same `acc` buffer already accumulated in `buildAgent`).
- Deploy button shows "Deploying…" and is disabled.

### 3. Phase: Generated AI Agent (status = `approved`)

Swap the card identity so it visually reads as a *delivered* agent, not a plan:

- Header chip changes from "PLAN" to **"LIVE AGENT"** with emerald accent + subtle glow.
- Top label changes to **"AI Agent Generated!"** (currently "AI Agent Planned!").
- Add a hero strip directly under the title:
  - Agent avatar/initial badge, agent name, one-line goal.
  - Primary CTA: **"Open Chat"** (switches `activeTab` to `dashboard` and selects this agent in `LiveAgentChat`).
  - Secondary: **"View Spec"** toggles the 8-section breakdown (collapsed by default in this phase so the agent feels like a product, not a document).
- The 8-section spec moves into a collapsible "Agent Blueprint" section underneath the hero — still available, no longer the headline.
- Replace the `Deploy AI Agent` button with a disabled "Deployed ✓" pill; keep `Edit Plan`, `Remove`, `Copy`.

### 4. Buttons row consistency

- Hide `Generate` (regenerate plan) once status = `approved` — regenerating a plan after the agent is live is misleading. Offer it again only if the user clicks `Edit Plan`.

## Technical details

- All state already exists: `agentStatus`, `agentName`, `agentFinalSpec`, `agentGreeting`, `agentSuggestions`, `agentChat` are populated by the existing `buildAgent` flow (lines 599–737). No new state needed.
- Checkpoint detection during streaming: derive from `lastNaz.content` by counting how many of `Agent Name`, `Autonomous Capabilities`, `Step-by-Step Workflow`, `Guardrails` headings appear. Pure render-time computation, no extra effects.
- "Open Chat" CTA: `setActiveTab("dashboard"); setSelectedSavedId(lastNaz.id);` — both setters already used elsewhere in the file.
- Visual tokens reuse existing `accent` object pattern (lines 1468–1473); add a new `approved` variant styled as live/emerald with a stronger glow + "LIVE AGENT" chip label.

## Out of scope

- No edge function changes. The `run-ai-agent` build prompt is already correct (compiles a deployed manifest, forbids "plan"/"draft"/"blueprint" words).
- No new routes, no DB changes.
- Chat surface itself (`LiveAgentChat`) is unchanged — we just route the user to it more prominently.

## Answer to your question

Yes — NazAI already knows how to generate a real AI Agent (the `run-ai-agent` "build" mode compiles the approved plan into a deployed, operational manifest with real triggers, tools, KPIs). What was missing is the **UI signaling** that the deployment actually happened. This plan fixes that: live generation console while it builds, then a clearly different "Generated AI Agent" view replacing the plan card.

&nbsp;

**That AI Agent is like an AI-built AI tool**