## Goal

Right now, when the user sends a prompt in the workspace (especially in **Plan** mode), NazAI replies with a plan but never actually builds an AI agent from it. We'll add an explicit **Build** step that turns the most recent plan into a real generated AI agent, shown in the same chat + preview surface.

## Flow

```text
User prompt
  → NazAI Plan (chat + preview)
    → [Build Agent from this plan] button appears under the plan
      → calls generate-ai-agent with: user prompt + the plan as context
        → streams the final AI Agent into chat + preview (same surface)
```

No new pages. Same workspace. The agent appears right where the plan was, so it feels like a continuation, not a new flow.

## Changes (frontend only — `src/pages/GenerationWorkspace.tsx`)

1. **Track plan messages**
   - When `chatMode === "plan"` and NazAI replies, mark that message with `isPlan: true` (extend the `ChatMessage` type).

2. **Add "Build Agent from this plan" CTA**
   - Under any NazAI message where `isPlan` is true and streaming is finished, render a button:
     - Label: `Build Agent from this plan`
     - Icon: `Hammer`
     - Style: matches existing purple→cyan gradient buttons.
   - Show it both in the chat sidebar and at the bottom of the preview pane when the latest NazAI message is a plan.

3. **Wire the button to a `buildAgentFromPlan()` handler**
   - Find the most recent plan message + the most recent user prompt.
   - Push a synthetic user message to chat: `"Build the AI agent from the plan above."`
   - Call `streamFromNazAI(...)` with `forcedAgentRef.current = true` for this call so it always hits `generate-ai-agent`, passing:
     - `prompt`: original user request
     - `messages`: full history including the plan
   - The existing streaming code already renders the agent into chat AND the preview pane, so no preview changes needed beyond the CTA.

4. **Mode hint**
   - When the user clicks Build, also switch `chatMode` from `plan` → `build` so the UI state matches what just happened.

5. **Empty / error states**
   - If no plan exists yet, the button is not rendered.
   - If the build call fails, fall back to `createAgentFallback()` (already implemented).

## Backend

No changes. `generate-ai-agent` already accepts `{ prompt, messages }` and streams the agent. The plan is included via `messages`, which the system prompt will use as context.

## Validation

1. Go to `/generator-home`, pick **AI Agent**, enter a short prompt, hit Generate.
2. In the workspace, switch chat mode to **Plan**, send a prompt like "AI agent that triages support tickets".
3. NazAI returns a plan in chat + preview.
4. Click **Build Agent from this plan** under the plan.
5. The agent streams in below, replacing the preview content with the final 8-section agent spec.
6. Confirm the network tab shows a call to `/functions/v1/generate-ai-agent`.
