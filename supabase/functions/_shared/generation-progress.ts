// GAP 8 (Speed & Reliability Layer): real phase-checkpoint reporting for a
// generation request, replacing GeneratorHome.tsx's blind client-side timer.
// Best-effort and fire-and-forget by design -- a progress write is a UX nicety,
// never allowed to slow down or fail a real generation.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function reportProgress(
  admin: SupabaseClient,
  requestId: string | null | undefined,
  userId: string | null | undefined,
  stage: string,
): Promise<void> {
  if (!requestId || !userId) return;
  try {
    await admin.from("generation_progress").upsert({
      request_id: requestId,
      user_id: userId,
      stage,
      updated_at: new Date().toISOString(),
    }, { onConflict: "request_id" });
  } catch { /* progress reporting must never break a real generation */ }
}
