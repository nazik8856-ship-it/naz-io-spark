import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { findCoverageGaps, classifyCoverage, type CapabilityForCoverage, type HardRuleForCoverage, type CoverageCellStatus } from "@/lib/coverage-gaps";
import { GATE_ERROR_SOURCES, engineUptimeStats } from "@/lib/control-health";
import { lastNDays, bucketCountByDay, bucketEfficiencyByDay } from "@/lib/control-dashboard";

const WINDOW_DAYS = 7;
const DEFAULT_CAP = 5;

export type ControlDashboardData = {
  loading: boolean;
  coveragePct: number | null; // null = no real connected capabilities yet to cover
  coverageGapCount: number;
  coverageTotal: number;
  coverageCells: (CapabilityForCoverage & { status: CoverageCellStatus })[];
  healthPct: number | null; // null = no decision volume in window yet
  spend: { today: number; cap: number; capIsCustom: boolean; series: number[] };
  incidents: { openCount: number; series: number[] };
  efficiency: { autonomousPct: number | null; series: (number | null)[] };
  pendingApprovalsCount: number;
  setup: { hardRules: boolean; safetyRules: boolean; spendCapCustom: boolean; agentDeployed: boolean; pct: number };
  days: string[];
  refetch: () => void;
};

/**
 * Single data source for the Control System landing dashboard (blueprint
 * task #63). Every number here is read from tables/functions that already
 * back an existing full page (ControlCoverageGaps' coverage-gap finder,
 * ControlHealthView's uptime stat, useSpendSafetyStatus's spend fields,
 * ControlIncidents'/ControlApprovals' own tables) -- nothing here invents a
 * new metric, it just aggregates the same real signals into one landing
 * view with a short trend per stat card.
 */
export function useControlDashboardData(accountId: string | undefined): ControlDashboardData {
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [coveragePct, setCoveragePct] = useState<number | null>(null);
  const [coverageGapCount, setCoverageGapCount] = useState(0);
  const [coverageTotal, setCoverageTotal] = useState(0);
  const [coverageCells, setCoverageCells] = useState<(CapabilityForCoverage & { status: CoverageCellStatus })[]>([]);
  const [healthPct, setHealthPct] = useState<number | null>(null);
  const [spend, setSpend] = useState({ today: 0, cap: DEFAULT_CAP, capIsCustom: false, series: [] as number[] });
  const [incidents, setIncidents] = useState({ openCount: 0, series: [] as number[] });
  const [efficiency, setEfficiency] = useState<{ autonomousPct: number | null; series: (number | null)[] }>({ autonomousPct: null, series: [] });
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [setup, setSetup] = useState({ hardRules: false, safetyRules: false, spendCapCustom: false, agentDeployed: false, pct: 0 });

  const days = lastNDays(WINDOW_DAYS);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const firstDay = days[0];
    const today = days[days.length - 1];

    const [
      statusRes,
      hardRulesRes,
      safetyRulesCountRes,
      decisionsRes,
      cleanAllowRes,
      spendCapRes,
      spendDailyRes,
      incidentsOpenRes,
      incidentsRecentRes,
      pendingRes,
      agentsCountRes,
    ] = await Promise.all([
      supabase.functions.invoke("capability-status", { body: { account_id: accountId } }),
      anyDb.from("hard_rules").select("action_type_pattern, provider, enabled, shadow_mode, agent_id").eq("user_id", accountId),
      anyDb.from("safety_rules").select("id", { count: "exact", head: true }).eq("user_id", accountId),
      anyDb.from("agent_decisions").select("source, decision, escalated, created_at").eq("user_id", accountId).gte("created_at", since),
      anyDb.from("clean_allow_counts").select("count").eq("user_id", accountId).gte("window_start", since),
      // api_key_id must also be excluded -- a per-key cap/spend row has
      // agent_id IS NULL too, so without it maybeSingle() errors and the
      // 30-day list double-counts per-key spend into the account-wide total.
      anyDb.from("ai_spend_caps").select("daily_cap_usd").eq("user_id", accountId).is("agent_id", null).is("api_key_id", null).maybeSingle(),
      anyDb.from("ai_spend_daily").select("day, cost_usd").eq("user_id", accountId).is("agent_id", null).is("api_key_id", null).gte("day", firstDay),
      anyDb.from("incidents").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("status", "open"),
      anyDb.from("incidents").select("created_at").eq("user_id", accountId).gte("created_at", since),
      anyDb.from("pending_approvals").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("status", "pending"),
      anyDb.from("agents").select("id", { count: "exact", head: true }).eq("user_id", accountId),
    ]);

    // Coverage -- same definition ControlCoverageGaps.tsx uses: real,
    // connectable capabilities with no live (enabled, non-shadow) hard rule
    // matching them.
    const capabilities = ((statusRes.data?.capabilities ?? []) as { kind: string; provider: string; status: string }[])
      .filter((c) => c.status === "real")
      .map((c) => ({ kind: c.kind, provider: c.provider })) as CapabilityForCoverage[];
    const hardRules = (hardRulesRes.data ?? []) as HardRuleForCoverage[];
    const gaps = findCoverageGaps(capabilities, hardRules);
    setCoverageTotal(capabilities.length);
    setCoverageGapCount(gaps.length);
    setCoveragePct(capabilities.length > 0 ? Math.round(((capabilities.length - gaps.length) / capabilities.length) * 1000) / 10 : null);
    setCoverageCells(classifyCoverage(capabilities, hardRules));

    // Health -- same gate-error-rate complement ControlHealthView.tsx uses,
    // folding in clean_allow_counts so a quiet account on mostly clean
    // fast-mode traffic doesn't read as having "no data."
    const decisionRows = (decisionsRes.data ?? []) as { source: string; decision: string; escalated: boolean; created_at: string }[];
    const extraCleanAllows = ((cleanAllowRes.data ?? []) as { count: number }[]).reduce((sum, r) => sum + r.count, 0);
    const total = decisionRows.length + Math.max(0, extraCleanAllows);
    const gateErrors = decisionRows.filter((d) => GATE_ERROR_SOURCES.has(d.source)).length;
    setHealthPct(engineUptimeStats(gateErrors, total).uptimePct);

    // Spend -- same fields useSpendSafetyStatus.ts exposes, plus a 7-day series.
    const cap = Number(spendCapRes.data?.daily_cap_usd ?? DEFAULT_CAP);
    const spendByDay = new Map(((spendDailyRes.data ?? []) as { day: string; cost_usd: number }[]).map((r) => [r.day, Number(r.cost_usd)]));
    setSpend({
      today: spendByDay.get(today) ?? 0,
      cap,
      capIsCustom: !!spendCapRes.data,
      series: days.map((d) => spendByDay.get(d) ?? 0),
    });

    // Incidents -- same `incidents` table ControlHealthView/ControlIncidents use.
    setIncidents({
      openCount: incidentsOpenRes.count ?? 0,
      series: bucketCountByDay((incidentsRecentRes.data ?? []) as { created_at: string }[], (r) => r.created_at, days),
    });

    // Efficiency -- roi-report.ts's own "autonomous = not escalated" framing,
    // bucketed daily instead of as a single range total.
    const autonomousCount = decisionRows.filter((d) => !d.escalated).length;
    setEfficiency({
      autonomousPct: decisionRows.length > 0 ? Math.round((autonomousCount / decisionRows.length) * 1000) / 10 : null,
      series: bucketEfficiencyByDay(decisionRows, (d) => d.created_at, (d) => d.escalated, days),
    });

    setPendingApprovalsCount(pendingRes.count ?? 0);

    setSetup({
      hardRules: hardRules.length > 0,
      safetyRules: (safetyRulesCountRes.count ?? 0) > 0,
      spendCapCustom: !!spendCapRes.data,
      agentDeployed: (agentsCountRes.count ?? 0) > 0,
      pct: Math.round(
        ([hardRules.length > 0, (safetyRulesCountRes.count ?? 0) > 0, !!spendCapRes.data, (agentsCountRes.count ?? 0) > 0].filter(Boolean).length / 4) * 100,
      ),
    });

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => { void load(); }, [load, tick]);

  return {
    loading,
    coveragePct,
    coverageGapCount,
    coverageTotal,
    coverageCells,
    healthPct,
    spend,
    incidents,
    efficiency,
    pendingApprovalsCount,
    setup,
    days,
    refetch: () => setTick((t) => t + 1),
  };
}
