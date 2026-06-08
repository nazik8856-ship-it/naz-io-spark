## Goal

When the user submits an AI Agent request, NazAI must:

1. Use the new strict "AI Agent Architect" system prompt (your exact template).
2. Stream a **compact spec card** into chat (smaller than the full 8-section dump) with **Approve / Edit / Remove** controls.
3. On Approve (and automatically after a short idle if user does nothing), immediately render the full agent in the preview pane — no excuses, no extra plan step.

## Flow

```text
User prompt (AI Agent mode)
  → generate-ai-agent streams the 8-section spec (new prompt)
    → Chat shows a COMPACT card: Name + Description + Primary Goal + capability count,etc...
       [Approve]  [Edit]  [Remove]
        │           │        │
        │           │        └─ discard, no preview write
        │           └─ inline textarea to tweak the spec, then Approve
        └─ Generates an AI agent based on this
           (auto-approve after 6s if user is idle)
```

## Backend — `supabase/functions/generate-ai-agent/index.ts`

Replace `SYSTEM_PROMPT` with the user's exact "AI Agent Architect" template (the 8-section block, OUTPUT RULES, no preamble). Keep the rest of the function (Lovable AI Gateway, streaming, 429/402 handling) unchanged.

User prompt composition stays:

```
User's request: <prompt>
Industry: <industry|infer>
Challenges: <challenges|infer>
```

## Frontend — `src/pages/GenerationWorkspace.tsx`

1. **New message kind**: extend `ChatMessage` with `kind?: "agent-spec"` and `agentStatus?: "pending" | "approved" | "removed"`.
2. **Detect agent runs**: when `forcedAgentRef.current === true` (AI Agent flow), tag the streamed assistant message as `kind: "agent-spec"`, `agentStatus: "pending"`.
3. **Compact card renderer** (new small component, inline in this file or `src/components/chat/AgentSpecCard.tsx`):
  - Parses the streamed text for sections `1.` (Name), `2.` (Description), `3.` (Primary Goal), counts bullets under `4.`.
  - Shows: **Name** (bold), 2-line description (clamped), Primary Goal pill, "N capabilities • workflow ready".
  - Buttons: `Approve & Build` (primary gradient), `Edit` (opens an inline textarea bound to the raw spec), `Remove` (sets `agentStatus: "removed"` and hides the preview write).
4. **Approve handler**: flips `agentStatus` to `approved`, writes the full spec into the existing preview pane state (same code path that already renders the agent today) and shows a tiny "Live" badge on the card.
5. **Auto-approve**: when streaming finishes for an `agent-spec` message and `agentStatus` is still `pending`, start a 6s timer that calls Approve automatically unless the user clicks Edit or Remove. Cancel timer on any interaction.
6. **Edit mode**: textarea pre-filled with the raw spec; Save updates the message content and triggers Approve. No re-call to the model.
7. **Remove**: clears the preview pane back to empty state and marks the chat card as dismissed (struck-through name, restore button).

## Validation

1. `/generator-home` → AI Agent → prompt 
2. Chat shows a compact card (Name + 2-line desc + Primary Goal + "6 capabilities"), not the full wall of text.
3. Card has Approve / Edit / Remove. After 10s of inactivity it auto-approves.
4. Preview pane fills with the full 8-section spec.
5. Network: single call to `/functions/v1/generate-ai-agent`, SSE 200.
6. Edit then Approve updates the preview without re-hitting the function.

## Files

- `supabase/functions/generate-ai-agent/index.ts` — swap `SYSTEM_PROMPT`.
- `src/pages/GenerationWorkspace.tsx` — message kind, compact card, approve/edit/remove handlers, auto-approve timer.
- (optional) `src/components/chat/AgentSpecCard.tsx` — extracted card component.