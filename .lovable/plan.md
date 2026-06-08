## Goal

"Approve & Build" must actually **build a working AI agent** the user can talk to in the preview pane — not just paste the spec there. The spec becomes the agent's identity + system prompt, and the preview turns into a live chat with that agent.

## Flow

```text
Spec card in chat → [Approve & Build]
   → mark agentStatus = "building"
   → call new edge fn `run-ai-agent` with { spec } to materialize the agent
       (returns: { agentId, systemPrompt, name, greeting, suggestedPrompts[] })
   → preview pane swaps to <LiveAgentChat>:
       • Agent header (name + 1-line goal)
       • Streaming chat window
       • Suggested prompts as chips
       • Composer → POSTs each turn to `run-ai-agent` with { agentId|spec, messages }
   → user can talk to the agent immediately
```

## Backend — new edge function `supabase/functions/run-ai-agent/index.ts`

- POST `{ spec: string, messages?: {role,content}[] }`.
- Two modes:
  - **init** (no messages): returns JSON `{ name, greeting, suggestedPrompts:[3], systemPrompt }`. `systemPrompt` is derived from the spec: "You are &nbsp;. &nbsp;. Primary Goal: &nbsp;. Capabilities: …. Follow guardrails: …. Stay in character."
  - **chat** (messages present): streams SSE chat completion using that derived `systemPrompt` + history.
- Uses Lovable AI Gateway (`google/gemini-3-flash-preview`), handles 429/402, CORS.
- Config: add `[functions.run-ai-agent] verify_jwt = false` block in `supabase/config.toml`.

## Frontend — `src/pages/GenerationWorkspace.tsx`

1. Extend `AgentStatus` with `"building"`. Add fields to `ChatMessage`:
  `agentId?`, `agentName?`, `agentGreeting?`, `agentSuggestions?: string[]`, `agentChat?: {role,content}[]`, `agentStreaming?: boolean`.
2. Replace current `approveAgent` with `buildAgent(id)`:
  - Set `agentStatus: "building"`.
  - Call `run-ai-agent` init → store name/greeting/suggestions/systemPrompt on the message.
  - Set `agentStatus: "approved"` and seed `agentChat` with the greeting.
3. **Auto-build**: change the 10s auto-approve effect to call `buildAgent` instead.
4. New `sendAgentTurn(messageId, text)`:
  - Appends user turn, sets `agentStreaming: true`.
  - SSE-streams `run-ai-agent` with `{ spec: m.content, messages: m.agentChat }` and appends assistant deltas to `agentChat`.
5. **Preview pane**: when the latest approved nazai message is `kind: "agent-spec"`, render a new inline `<LiveAgentChat>` block instead of the markdown dump:
  - Header: gradient avatar, `agentName`, small "Live agent · 1 turn" stat.
  - Scrollable transcript of `agentChat` (user bubbles right, agent left, markdown for agent).
  - Suggestion chips (click → sends as turn).
  - Composer (textarea + send) wired to `sendAgentTurn`.
  - "View full spec" toggle that expands the original 8-section markdown underneath.
6. If `agentStatus === "building"`: show a neo-brutalist  'N' ("Booting agent…") in the preview.
7. When agentStatus === "finished" : show a generated AI Agent in the preview

## Validation

1. `/generator-home` → AI Agent Generation -> Ai Agent.
2. Compact spec card appears in chat with Approve & Build / Edit / Remove.
3. Click **Approve & Build** → preview shows "Booting agent…" briefly, then live chat with  3 suggestion chips and Generated AI Agent in a bit of time
4. Type "Book a table for 4 tonight at 8" → agent does the real work inside him(his platform)
5. Network: one `run-ai-agent` init call + one streaming call per turn.
6. Edit then Approve & Build re-initializes the agent with the edited spec.

## Files

- `supabase/functions/run-ai-agent/index.ts` — new.
- `supabase/config.toml` — `verify_jwt = false` block for `run-ai-agent`.
- `src/pages/GenerationWorkspace.tsx` — new status, build/chat handlers, `<LiveAgentChat>` block in preview, replace approve handler.