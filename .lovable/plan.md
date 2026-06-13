## What's actually wrong

Two separate problems are stacking on top of each other:

### 1. The screenshot is from the published site (`spark.lovable.app`), not the preview

The card in your screenshot says **"Business Resilience Agent"** with a description that mentions *"retail cash..."* — but your prompt was about *Braddy financial insights*. That text does not exist anywhere in the current codebase (I searched). It is coming from **`localStorage["nazai_saved_agents"]`** which was written by the **old `createAgentFallback` build** that is still live on `spark.lovable.app`. The preview branch already has the fallback removed; the published branch does not.

So fix #1 is just: **republish**. Until you do, every visitor to `spark.lovable.app` keeps seeing whatever fallback agent their browser saved last week.

### 2. The Preview tab agent card never actually renders the 8 sections

This is the real code bug. The previous summary claimed the Preview tab renders all 8 sections — it does not. Lines 844–895 of `src/pages/GenerationWorkspace.tsx` render only:

- Agent name
- 2-line truncated description (`line-clamp-2`)
- 1-line truncated goal (`line-clamp-1`)
- A literal hard-coded string: `"6 capabilities · workflow ready"`
- Live / Edit / Remove buttons

That is why after Approve & Build flips to "Live", you still see no real agent. The full structured render with Workflow / Guardrails / Deployment bullets only exists on the **Chat** tab side panel (lines ~1261–1370), not in the Preview tab message stream.

## Fix plan

### A. Render the full structured agent card inside the Preview tab message (the real fix)

In `src/pages/GenerationWorkspace.tsx`, replace the collapsed card at lines 844–895 with an expanded card that uses the existing `parseAgentSpec(m.content)` result and shows all 8 sections inline once `m.agentStatus === "approved"`:

- **Header:** Name + Live/Booting/Pending badge (keep).
- **Description:** remove `line-clamp-2`, render full text.
- **Primary Goal:** remove `line-clamp-1`, render full text with the 🎯 prefix.
- **Autonomous Capabilities:** render `toBullets(spec.capabilities)` as a real `<ul>` (not the hardcoded "6 capabilities" string).
- **Step-by-Step Workflow:** numbered list from `toBullets(spec.workflow)`.
- **Guardrails & Safety:** bullet list from `toBullets(spec.guardrails)`.
- **Deployment Options:** bullet list from `toBullets(spec.deployment)`.
- **Expected Impact:** paragraph from `spec.impact`.
- Keep the existing Live / Edit / Remove action row underneath.

While streaming or before approval, keep a compact view (current collapsed card is fine for the in-flight state); switch to the full 8-section view as soon as `m.agentStatus === "approved"` and `m.agentFinalSpec` is set.

The parser and bullet helpers already exist (`parseAgentSpec` line 94, the JSX render at lines 1341–1370 shows the bullet pattern to copy). No new edge function work, no schema changes — purely presentational.

### B. Invalidate stale localStorage cache so old fallback agents disappear

Bump the localStorage key from `"nazai_saved_agents"` to `"nazai_saved_agents_v2"` (and same for `nazai_pending_prompt` if it carries stale state). A one-time migration on mount can delete the old key. This guarantees nobody — including current users on the published site — keeps seeing the `Business Resilience Agent` ghost row after we ship.

### C. Republish to `spark.lovable.app`

After A + B land in preview, publish. The preview URL already works correctly with the current backend; the published URL is the one stuck on the old build.

### D. (Optional, not required to close this) Move saved agents off localStorage

`localStorage` is per-device. If a client logs in from a second browser they will see no saved agents. A small `public.agents` table (`id`, `user_id`, `name`, `spec`, `system_prompt`, `created_at`) with RLS scoped to `auth.uid()` would fix that. Skip for this round if you only want the visible bug closed.

## Files to edit

- `src/pages/GenerationWorkspace.tsx` — replace the collapsed agent card render (lines ~844–895) with the full 8-section structured render, and bump the localStorage key.

## Out of scope

- No edge function changes. `generate-ai-agent` and `run-ai-agent` already return the full structured spec; the UI just wasn't displaying it.
- No removal of the Chat-tab side-panel render — keep it as-is.

## Acceptance check

1. New prompt → plan streams → auto-build fires → Preview card expands into all 8 sections with real bullets (not "6 capabilities · workflow ready").
2. Hard refresh `spark.lovable.app` → no "Business Resilience Agent" ghost row from old cache.
3. Stop button mid-generation cancels cleanly (already wired via `abortRef`).
