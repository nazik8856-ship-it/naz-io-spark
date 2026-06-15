## Goal

Fix three issues on `/generation-workspace`:

1. NazAI sometimes hangs on "thinking…" with no output.
2. The top toggle should show **Chat on the LEFT** and **Preview on the RIGHT**.
3. When generation completes, the workspace should **auto-switch to Preview** so the generated AI agent card is always visible.

## Scope

Frontend-only changes in `src/pages/GenerationWorkspace.tsx`. No edge function, schema, or auth changes.

## Changes

### 1. Swap tab order (Chat ↔ Preview)

In the center tab toggle (around line 871-880), reorder the array so the visible order becomes:

```
[ Chat ] [ Preview ]
```

The internal tab ids (`"preview"` and `"dashboard"`) stay the same to avoid touching every conditional downstream — only the rendered order in the toggle changes.

### 2. Auto-switch to Preview when agent generation finishes

In `buildAgent` / stream-completion path (where `agentStatus` becomes `approved` and `agentFinalSpec` is set), call `setActiveTab("preview")` so the user is taken straight to the generated agent card. Update the existing toast from "open Chat to talk to it" to a neutral "Agent ready — preview below."

### 3. Hang fix: 20s hard timeout + one silent auto-retry

In `streamFromNazAI` (the function that calls the `generate-ai-agent` edge function):

- Replace the current 45s hard timeout / 15s stall watchdog with a single **20s hard timeout** using `AbortController`.
- On timeout (or network error), if it is the first attempt for this prompt, **silently re-invoke the stream once** with the same prompt. Track this with a `retryCount` local variable so only one retry happens.
- If the retry also fails, keep the existing failed-card + visible Retry button so the user can tap retry manually.
- Keep the live progress bar/char counter that already exists.

### 4. Loading clarity

Keep the existing "NazAI is thinking…" indicator but replace it with a more specific label sequence driven by stream state:

- `submitted` → "Designing your agent…"
- first chunk received → "Streaming agent spec…"
- on timeout/retry → "Retrying…"

No new components, no schema changes.

## Out of scope

- Edge function changes (already verified to work).
- Queue-based architecture (not needed at 20s budget; current direct streaming is fine).
- Renaming internal tab ids.
- Any backend / Supabase work.

## Verification

- Submit the test prompt: `Generate an AI agent for retail cash flow and economic uncertainty.`
- Generates an AI Agent based on the prompt
- Confirm the toggle reads **Chat | Preview** (Chat on left).
- Confirm that on completion the view switches to the Preview tab automatically and shows nothing for now.
- Simulate a hang (throttle network) and confirm: it aborts at 20s, retries once silently, and only after the retry fails does the Retry button appear.