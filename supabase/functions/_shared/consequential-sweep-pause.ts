// "Sweep safety & observability" front, item 4: a dedicated pause switch for
// the 3 sweeps that take real, hard-to-reverse account-state actions
// (control-api-abuse-sweep pauses keys, outcome-quality-sweep downgrades
// on_uncertain, stuck-approval-sweep auto-resolves approvals). The existing
// platform-wide kill switch (platform_settings.kill_switch) never reaches
// any of the three -- it's checked only inside control-gate.ts's per-decision
// verdict path, and none of these sweeps ever calls control-gate.ts. This is
// the fast, narrow "these 3 are doing something wrong, stop them" lever that
// was genuinely missing.
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function areConsequentialSweepsPaused(admin: ReturnType<typeof createClient>): Promise<boolean> {
  const { data } = await admin
    .from("platform_settings")
    .select("consequential_sweeps_paused")
    .eq("id", 1)
    .maybeSingle();
  return Boolean((data as { consequential_sweeps_paused?: boolean } | null)?.consequential_sweeps_paused);
}
