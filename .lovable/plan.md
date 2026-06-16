## Goal

Make NazAI's agent generation truly reliable: prove it works with both vague and detailed prompts, fall back to Lovable AI silently if OpenAI fails (with one tiny notice — no repeated banners), and guarantee the Preview always renders a real card even if the model returns imperfect formatting.

## Changes

### 1. Edge function `generate-ai-agent` — add quiet fallback

- Keep OpenAI `gpt-4o-mini` as the primary path (user has balance).
- On `401`, `429`, `5xx`, or network failure from OpenAI, automatically retry once against the Lovable AI Gateway (`google/gemini-3-flash-preview`) using `LOVABLE_API_KEY` (already in secrets).
- Same system prompt, same streaming SSE shape, so the frontend doesn't need to know which provider answered.
- Add one header on the response: `X-Agent-Provider: openai | lovable`. No body change.
- No new error surfaces unless **both** providers fail — then return the existing JSON error.

### 2. Edge function `generate-ai-agent` — parser-friendly output contract

- Tighten the system prompt's heading rule to force exactly `1. **Agent Name**:` style (bold inside the number, colon outside), matching what `cleanAgentSpecOutput` / `parseAgentSpec` already expect.
- Add a one-line reminder at the end of the prompt: *"Use these exact headings verbatim, including the `**` and the trailing `:`. Do not renumber, rename, or merge sections."*
- This is the single most common reason sections get dropped — fixing it at the prompt is cheaper than rewriting the parser.

### 3. Frontend `GenerationWorkspace.tsx` — preview safety net + quiet provider notice

- In the stream-complete handler, if fewer than 8 sections parsed: render whatever sections came back inside the existing agent card (don't blank the Preview, don't show a failure state). The auto-retry already covers true failures.
- Read the `X-Agent-Provider` response header. If it equals `lovable`, show **one** small muted line under the agent card: *"Generated via backup model."* — shown once per generation, never as a toast, never repeated on chat replies. If header is `openai` or missing, show nothing.
- Keep the existing "NazAI filled in missing details. Use Chat to refine." hint for short prompts.
- No changes to tab order, timeout (20s + one retry), or Chat behavior.

### 4. Verification (actually run it this time)

After deploy, hit the function via `supabase--curl_edge_functions` with two payloads and read the streamed output:

1. Vague: `{ "prompt": "fitness" }` — expect 8 sections, an `Assumed:` line, no "thinking" hang.
2. Detailed: `{ "prompt": "AI agent that monitors retail cash flow daily and flags anomalies" }` — expect 8 sections, no `Assumed:` line, domain-specific wording.

Then check `supabase--edge_function_logs` for any 401/429 to confirm whether the fallback path activated.

### Out of scope (per user — discussed later)

- Persisting agents to the database (still `localStorage` only).
- Deducting a credit on generation (still free).

## Technical notes

- Lovable AI fallback uses the existing OpenAI-compatible shape, so only the URL, model, and auth header swap. Streaming response body is forwarded unchanged.
- No schema, auth, routing, or component-tree changes.
- No new dependencies, no new secrets (both keys already present).
