## Goal

Guarantee that NazAI **always** produces a complete 8-section AI Agent in the Preview tab, even when the user prompt is vague, one-word, or missing context. The agent must never stall,  ask clarifying questions if needed, and never return empty — NazAI fills the gaps itself with sensible assumptions that the user can later refine through Chat.

## Changes

### 1. Edge function (`supabase/functions/generate-ai-agent/index.ts`)

Strengthen the system prompt so the model treats sparse input as a creative brief rather than a blocker:

- Add an explicit rule: **"If the user prompt is short, vague, or missing context, you MUST invent a reasonable domain, audience, and feature set yourself. Never refuse, never ask questions, never return placeholder text. Always output the full 8 sections."**
- Add: **"State any assumptions you made inside the Description section (one short sentence prefixed with 'Assumed:'), so the user can correct them later via chat."**
- Keep the existing 8-section structure, OpenAI gpt-4o-mini wiring, and streaming response unchanged.
- Lower `temperature` slightly (0.5) and keep `max_tokens: 1600` so short prompts still get full output.

### 2. Frontend (`src/pages/GenerationWorkspace.tsx`)

- In `buildAgent`, before calling the edge function, **do not block on prompt length**. Remove/relax any "prompt too short" guards if present so even a 2-word prompt streams through.
- When the stream finishes, if the parsed result is missing any of the 8 sections, **do not show a failure card** — instead surface what came back and let the auto-retry (already in place) run once. After retry, always render whatever sections exist in the Preview tab so the user sees a real agent card, never a blank state.
- Keep the existing 25s timeout, one silent retry, auto-switch to Preview, and animated "Composing agent blueprint…" indicator.
- Add a small hint line under the agent card: *"NazAI filled in missing details. Use Chat to refine."* — shown only when the original prompt was under ~15 words.

### 3. No other changes

- No schema, auth, routing, tab-order, or component-tree changes.
- Chat tab behavior unchanged.

## Verification

- Submit a vague prompt like `fitness` or `make me something cool`. Confirm a full 8-section agent renders in Preview within ~20s, with an "Assumed: …" line inside Description.
- Submit a detailed prompt (retail cash flow). Confirm output still reflects the specifics and no "Assumed:" line is forced.
- Confirm no "thinking…" hang and no empty Preview state in either case.