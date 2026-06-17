## Reality check

The edge function `generate-ai-agent` is working: I just hit it with `{"prompt":"fitness"}` and it streamed back a clean 8-section spec with `X-Agent-Provider: openai`. So "generation doesn't work" is no longer a model/backend problem — it's an **agent lifecycle** problem. Below are the only things blocking you from saying "NazAI generates AI Agents" and meaning it.

## Top 5, in order

### 1. Make the generated agent actually runnable (highest priority)

Right now `generate-ai-agent` only produces a *spec*. There's a `run-ai-agent` edge function and a `LiveAgentChat` component, but the spec → live-chat handoff is fragile. Lock down:

- After generation completes, auto-build a **system prompt** from the 8 sections (Name + Description + Goal + Capabilities + Guardrails) and store it on the message as `agentSystemPrompt`.
- Wire a single **"Talk to agent"** button on the spec card that opens `LiveAgentChat` using that system prompt and calls `run-ai-agent` with the same OpenAI → Lovable fallback the generator uses.
- Confirm `run-ai-agent` streams, handles 429/402, and renders messages. If it doesn't, fix it the same way `generate-ai-agent` was fixed (non-streaming upstream + `sseFromText`).

Without this, the user generates beautiful text and can't do anything with it.

### 2. Persist agents so they survive a reload

Today agents live only in `localStorage` under `nazai_saved_agents_v2`, and only when the user clicks Save. Minimum viable persistence:

- New table `public.ai_agents` (id, user_id, name, spec, system_prompt, created_at, updated_at) with RLS scoped to `auth.uid()` and the standard GRANTs.
- Auto-save the agent the moment generation finishes (status = `draft`), then flip to `approved` when the user keeps it.
- Load the user's agents into the left sidebar of `GenerationWorkspace` instead of (or alongside) the localStorage list.

This is what turns "a demo" into "a product."

### 3. Edit-in-chat that actually edits the agent

The memory note says users should be able to refine via chat. Right now follow-up messages just stream a brand-new spec and overwrite the card. Needed:

- When a spec card already exists, follow-up user messages go to `generate-ai-agent` with `{ prompt, previousSpec, instruction }` and the system prompt instructs the model to **return the same 8 sections with the requested change applied** — not start over.
- Frontend replaces the existing card in place and shows a small "Updated: <what changed>" line.

### 4. Deduct 1 credit per generation (and per edit)

Per project memory, AI actions cost 1 credit via `deduct_credit` RPC. The generator currently runs free, which both violates the rule and hides the "out of credits" failure mode from QA. Add:

- Call `deduct_credit` from `generate-ai-agent` before the model call; on `false`, return 402 and let the existing 402 toast fire.
- Same call inside `run-ai-agent` per user turn (or per session, your call — pick one and document it).

### 5. One-screen QA pass on the failure modes that actually bite users

Before calling this done, run these four scenarios and fix whatever breaks — no new features until they all pass:

1. Prompt: `"fitness"` → spec card renders 8 sections, "Talk to agent" works, reload keeps the agent.
2. Prompt: `"AI agent that monitors retail cash flow daily and flags anomalies"` → no `Assumed:` line, domain-specific wording, live chat answers a follow-up question.
3. Edit: after #1, send `"make it for senior users and add a weekly progress email"` → same card updates, name/description reflect the change.
4. Force failure: temporarily unset `OPENAI_API_KEY` in the function env → Lovable fallback kicks in, header reads `X-Agent-Provider: lovable`, the small "Generated via backup model." line shows once.

## Out of scope for this pass

- Multi-agent orchestration, tool calling, MCP, scheduled runs, deployment to external surfaces. All of that is post-MVP and we should not touch it until 1–5 above are solid.

## Technical notes

- Keep using the existing `generate-ai-agent` and `run-ai-agent` functions; do not introduce a new AI SDK provider mid-flight — the OpenAI-compatible Lovable fallback already in place is enough for now.
- New table needs `GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agents TO authenticated;` plus `GRANT ALL ... TO service_role;` in the same migration, then RLS policies on `auth.uid() = user_id`.
- Credit deduction must happen server-side in the edge function, never from the client.
- Do not change tab order, the streaming protocol, or `cleanAgentSpecOutput` — those are stable and any churn there will reopen the parser bugs we just closed.
