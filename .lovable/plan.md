## Accurate bottleneck diagnosis

The main blocker is in `src/pages/GenerationWorkspace.tsx`:

1. User submits prompt from `GeneratorHome`.
2. `/generation-workspace` calls `streamFromNazAI`.
3. `streamFromNazAI` creates a new assistant message and streams the 8-section spec from `generate-ai-agent`.
4. After streaming finishes, it calls:

```ts
void buildAgent(assistantId, finalClean);
```

5. But `buildAgent` immediately does:

```ts
const msg = messages.find((x) => x.id === id);
...
if (!msg || !sourceSpec) return;
```

Because React state is stale inside that async closure, `messages` often does not yet contain the just-created assistant message. So `msg` is `undefined`, and `buildAgent` returns early. That means the streamed plan/spec never becomes:

- `agentStatus: "approved"`
- `agentFinalSpec`
- saved in `nazai_saved_agents_v2`
- available as the live chat agent

This is the highest-impact cause of “generation happened but no generated agent appeared.”

## Secondary blockers / confusing behavior

### 1. Successful build switches away from Preview

After the agent initializes, the code runs:

```ts
setActiveTab("dashboard");
```

So even if the build succeeds, the user is moved to Chat instead of seeing the complete 8-section card in Preview. This conflicts with the desired behavior: “Show the complete agent card immediately in Preview tab after generation.”

### 2. Build errors are still partially masked

`buildAgent` catches build failure and marks the salvaged source spec as approved:

```ts
agentStatus: "approved"
agentFinalSpec: salvaged
```

That is not the old fake generic fallback, but it still hides a real build failure by presenting the agent as built. It should instead preserve the generated spec visibly, show the real error, and not mark it as `approved` unless the build actually completed.

### 3. Raw function fetches are brittle

The frontend manually builds function URLs from:

```ts
import.meta.env.VITE_SUPABASE_URL
import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
```

If either env var name differs or is unavailable in a deployment, generation fails before reaching the AI function. The app already has a backend client wrapper; this flow should use the existing client/function invocation pattern or a shared helper that supports both publishable/anon env names.

### 4. “Dashboard save” is only local workspace storage

The current save path writes to:

```ts
localStorage["nazai_saved_agents_v2"]
```

That powers the workspace Chat tab, but it does not persist to the main dashboard/project database. If the requirement means the main dashboard should show generated agents, this needs a database/project persistence step too.

## Implementation plan to close AI Agent generation today

### Step 1: Fix the auto-build stale-state bug

Change `buildAgent` so it accepts a full spec override without requiring the message to already exist in the closed-over `messages` array.

Target behavior:

- If `specOverride` is provided, build from that spec even when `messages.find(...)` is stale.
- Use functional `setMessages` updates to find/update the latest message state.
- Never silently return after generation when the final spec exists.

### Step 2: Keep the completed agent in Preview

Remove the automatic `setActiveTab("dashboard")` after init.

Target behavior:

- Preview remains active.
- The 8-section complete card shows immediately.
- The user can click `Live` to chat with the agent.

### Step 3: Make errors truthful

Update `buildAgent` failure handling:

- Do not mark failed builds as `approved`.
- Preserve the generated spec/card on screen.
- Show the exact error in the Preview card.
- Allow retry via `Approve & Build` / `Build` button.

### Step 4: Harden function calls

Replace repeated raw `fetch(`${VITE_SUPABASE_URL}/functions/v1/...`)` usage with a small helper or existing backend client call that consistently handles:

- URL resolution
- publishable/anon key mismatch
- status-specific errors: 429, 402, 401/403, 500
- readable error details from function responses

### Step 5: Verify the final flow

Validate this exact path:

```text
GeneratorHome prompt
→ GenerationWorkspace opens
→ generate-ai-agent streams strict 8-section spec
→ run-ai-agent mode=build auto-runs
→ Preview shows complete approved 8-section card
→ localStorage saves agent
→ Live chat can open and respond
→ failures show real error without fake fallback
```

## Bottom line

The bottleneck is not the AI prompt or the edge function structure. The main bottleneck is frontend state timing: `buildAgent` depends on stale `messages` immediately after streaming, so auto-approval/build can exit before saving or showing the full live agent.