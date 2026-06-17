## Goal

Make AI Agent generation almost never fail. Kill the "Backend connection is not ready" wall, fall back to known-good Supabase constants, and silently retry harder before showing any error card.

## Root cause of the screenshot

`src/pages/GenerationWorkspace.tsx` throws `"Backend connection is not ready"` whenever `import.meta.env.VITE_SUPABASE_URL` or the publishable key is undefined in the loaded bundle (most likely on a stale published build of `naz-io-spark.lovable.app`). The thrown error is caught and rendered as the yellow banner before any network call is even attempted.

Additionally:

- `src/integrations/supabase/client.ts` has stale fallback constants pointing at a different project (`gowbbsqwkciicsxyndyq`), so even the safety net is broken.
- Only **1** silent retry happens on failure, then the error card is shown. Transient network blips therefore become user-visible failures.

## Changes

### 1. `src/integrations/supabase/client.ts`

- Replace the stale fallback `SUPABASE_URL` with the current project URL `https://qaeduinfirtljnbecyzq.supabase.co`.
- Replace the stale fallback anon key with the current project's publishable anon key.
- Export two new constants used elsewhere:
  ```ts
  export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
  export const SUPABASE_ANON = SUPABASE_ANON_KEY;
  ```

### 2. `src/pages/GenerationWorkspace.tsx`

- Import `SUPABASE_FUNCTIONS_URL` and `SUPABASE_ANON` from the client module.
- Remove the env-var check from `functionHeaders()` (never throw). Compute base URL and key from env first, fall back to the exported constants.
- Bump the auto-retry from 1 attempt to 5 silent retries with 800ms/1600ms/3200ms backoff. Only after the 3rd failure do we render the yellow `agentError` card. Show a small toast on the 2nd retry ("Reconnecting...") so the user knows it's working.
- Do the same change in the `run-ai-agent` and init paths (lines 619, 693, 784) — never throw on missing env, never give up after one network blip.

### 3. (No backend changes)

The edge function already provider-falls-back (OpenAI → Lovable Gemini) and is verified working. We're only hardening the client.

## Out of scope

- DB persistence of agents (still localStorage as before).
- Credit deduction (still off).
- Any UI/layout change to the Preview card itself.

## QA after build

1. Load `/generation-workspace`, type "fitness" → full 8-section card streams in.
2. Throttle network in devtools to slow 3G → no yellow banner; card eventually streams.
3. Block the function URL once via devtools request blocking → silent retry kicks in, second attempt succeeds, no banner.
4. Block 3 times in a row → banner finally shows with Retry button (existing behaviour).

After approval and build, re-publish so the live `naz-io-spark.lovable.app` ships these fixes.