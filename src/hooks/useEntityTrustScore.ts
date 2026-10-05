import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { computeTrustScore, type TrustScoreReport } from "@/lib/trust-score";

const LOOKBACK_DAYS = 90;

/**
 * GAP 10 (Unified UX): the same per-entity trust score ControlEntities.tsx
 * already computes for its whole list, extracted into a single-entity hook
 * so a single-agent page (GeneratedDashboard.tsx) can show it without
 * pulling in that page's batch-everything query set. Same inputs, same
 * lookback window, same account-wide calibration-gap fallback (confidence_
 * calibration has no agent_id column -- only api_key_id -- so an agent's
 * calibration signal is necessarily the account-wide average, same as
 * ControlEntities.tsx's trustScoreForAgent).
 */
export function useEntityTrustScore(
  accountId: string | undefined,
  kind: "agent" | "api_key" | undefined,
  entityId: string | undefined,
): TrustScoreReport | null {
  const [report, setReport] = useState<TrustScoreReport | null>(null);

  const load = useCallback(async () => {
    if (!accountId || !kind || !entityId) return;
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const entityCol = kind === "agent" ? "agent_id" : "api_key_id";

    const [calibRes, decisionsRes, selfRepairRes, modifyRes] = await Promise.all([
      kind === "agent"
        ? anyDb.from("confidence_calibration").select("calibration_gap").eq("user_id", accountId).is("api_key_id", null).gte("period_end", since)
        : anyDb.from("confidence_calibration").select("calibration_gap").eq("user_id", accountId).eq("api_key_id", entityId).gte("period_end", since),
      anyDb.from("agent_decisions").select("source").eq("user_id", accountId).eq(entityCol, entityId).eq("is_test", false).gte("created_at", since).limit(10000),
      kind === "agent"
        ? anyDb.from("agent_events").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("agent_id", entityId).eq("kind", "self_repair").gte("created_at", since)
        : Promise.resolve({ count: 0 }),
      anyDb.from("outer_control_evaluations").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq(entityCol, entityId).eq("verdict", "modify").gte("created_at", since),
    ]);

    const gaps = ((calibRes.data ?? []) as { calibration_gap: number | null }[]).map((r) => Math.abs(Number(r.calibration_gap) || 0));
    const avgCalibrationGap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;

    const decisions = (decisionsRes.data ?? []) as { source: string | null }[];
    const ruleTriggered = decisions.filter((d) => d.source === "hard_rule" || d.source === "safety_scanner").length;
    const repairInterventions = selfRepairRes.count ?? 0;
    const modifyCount = modifyRes.count ?? 0;

    setReport(computeTrustScore({
      avgCalibrationGap,
      totalDecisions: decisions.length,
      ruleTriggeredDecisions: ruleTriggered,
      repairInterventions: repairInterventions + modifyCount,
    }));
  }, [accountId, kind, entityId]);

  useEffect(() => { void load(); }, [load]);

  return report;
}
