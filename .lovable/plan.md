## Goal

Confirm whether NazAI's AI agent generation issue is caused by the model not producing a real agent, the stream/parser dropping output, or the UI hiding/parsing it incorrectly.

Test prompt to use:

```text
Generate an AI agent for retail cash flow and economic uncertainty.
```

## Plan

### 1. Add generation diagnostics to the frontend

In `src/pages/GenerationWorkspace.tsx`, add a small internal debug object per agent message that records:

- endpoint called: `generate-ai-agent` / `run-ai-agent`
- HTTP status
- first SSE chunk preview
- total raw characters accumulated
- cleaned spec length
- parsed section count
- final error text, if any

This will tell us exactly where output disappears.

### 2. Add browser console logs for the exact generation path

Add focused `console.info` / `console.warn` logs around:

- function response status
- first chunk received
- every final stream completion
- empty-output failure
- parse result after cleaning
- auto-build start/success/failure

Keep logs namespaced as `[NazAI Agent Gen]` so they are easy to find and remove later.

### 3. Show a raw-output debug panel only when needed

In the Preview agent card, show an expandable diagnostic panel when either:

- `agentError` exists
- the raw output exists but `parseAgentSpec` finds no useful sections
- the final cleaned spec length is suspiciously small

The panel should display:

- status
- raw output preview
- cleaned output preview
- parsed fields present/missing
- error message

This avoids clutter during normal successful generation.

### 4. Preserve current generation behavior

Do not change models, prompts, edge functions, or storage yet.

This pass is diagnostic-only so we can accurately answer whether NazAI:

- generated a real 8-section agent but UI failed
- generated malformed text
- returned no stream content
- hit an HTTP / AI provider error
- failed during auto-build

### 5. Verify with your retail cash-flow prompt

After implementation, run the prompt through the app and inspect:

```text
Generate an AI agent for retail cash flow and economic uncertainty.
```

Expected proof:

- If raw output is a full 8-section agent, the model knows what to generate and the bottleneck is parser/UI/build.
- If raw output is empty, the bottleneck is streaming/function/provider.
- If raw output is generic or malformed, the bottleneck is prompt/model compliance.
- If HTTP status is 402/429/500, the bottleneck is credits/rate/provider config.

## Important note

Based on current code, NazAI does have a real AI generation function and a strict 8-section agent prompt. The unproven part is whether that output survives streaming, parsing, auto-build, and rendering. This diagnostic will make that visible instead of guessing.