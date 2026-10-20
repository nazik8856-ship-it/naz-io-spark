import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { findCoverageGaps, classifyCoverage, type CapabilityForCoverage, type HardRuleForCoverage, type CoverageCellStatus } from "@/lib/coverage-gaps";
import { GATE_ERROR_SOURCES, engineUptimeStats } from "@/lib/control-health";
import { lastNDays, bucketCountByDay, bucketEfficiencyByDay } from "@/lib/control-dashboard";
import { computeTrustScore, type TrustScoreReport } from "@/lib/trust-score";
import { computeGovernanceHealth, type GovernanceHealth } from "@/lib/governance-health";
import { rulesFor, type InnerProject } from "@/lib/inner-projects";

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
  // GAP 10 (Unified UX): account-wide trust score + the same traffic light
  // shown on every agent's own page and every Governed Entities row.
  accountTrustScore: TrustScoreReport | null;
  accountHealth: GovernanceHealth | null;
  /** The trust score as one number: of the project when one is shown (a website's stored score, an agent's computed one), else the account's. */
  trustScoreValue: number | null;
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
export function useControlDashboardData(accountId: string | undefined, project?: InnerProject | null): ControlDashboardData {
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
  const [accountTrustScore, setAccountTrustScore] = useState<TrustScoreReport | null>(null);
  const [accountHealth, setAccountHealth] = useState<GovernanceHealth | null>(null);
  const [trustScoreValue, setTrustScoreValue] = useState<number | null>(null);
  const scopeKey = project === undefined ? "account" : project === null ? "none" : project.key;

  const days = lastNDays(WINDOW_DAYS);

  const load = useCallback(async () => {
    // null: no project is chosen yet (or the account has none), so there is nothing to show.
    if (!accountId || project === null) return;
    setLoading(true);
    // With a project, every number is that project's. An agent: its own decisions, spend and incidents. A website makes no agent
    // decisions, so those are empty (the all-zero id matches no row), and its spend is the account's.
    const NIL = "00000000-0000-0000-0000-000000000000";
    const agentId = project?.kind === "agent" ? project.id : null;
    const isWebsite = project?.kind === "website";
    const scoped = !!project;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = (q: any) => (agentId ? q.eq("agent_id", agentId) : isWebsite ? q.eq("agent_id", NIL) : q);
    let decisionIds: string[] | null = null; // null = every incident of the account
    if (agentId) {
      const { data: ids } = await anyDb.from("agent_decisions").select("id").eq("agent_id", agentId).limit(2000);
      decisionIds = ((ids ?? []) as { id: string }[]).map((r) => r.id);
    }
    const noIncidents = isWebsite || (decisionIds !== null && decisionIds.length === 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mineIncidents = (q: any) => (decisionIds ? q.in("decision_id", decisionIds) : q);
    const none = { data: [], count: 0, error: null };
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const since90Days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
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
      calibRes,
      decisions90Res,
      selfRepairRes,
      modifyRes,
      agentCapRes,
    ] = await Promise.all([
      supabase.functions.invoke("capability-status", { body: { account_id: accountId } }),
      anyDb.from("hard_rules").select("action_type_pattern, provider, enabled, shadow_mode, agent_id").eq("user_id", accountId),
      anyDb.from("safety_rules").select("id, agent_id, api_key_id").eq("user_id", accountId),
      mine(anyDb.from("agent_decisions").select("source, decision, escalated, created_at").eq("user_id", accountId).gte("created_at", since)),
      scoped ? Promise.resolve(none) : anyDb.from("clean_allow_counts").select("count").eq("user_id", accountId).gte("window_start", since),
      // api_key_id must also be excluded -- a per-key cap/spend row has
      // agent_id IS NULL too, so without it maybeSingle() errors and the
      // 30-day list double-counts per-key spend into the account-wide total.
      anyDb.from("ai_spend_caps").select("daily_cap_usd").eq("user_id", accountId).is("agent_id", null).is("api_key_id", null).maybeSingle(),
      (agentId
        ? anyDb.from("ai_spend_daily").select("day, cost_usd").eq("user_id", accountId).eq("agent_id", agentId).is("api_key_id", null).gte("day", firstDay)
        : anyDb.from("ai_spend_daily").select("day, cost_usd").eq("user_id", accountId).is("agent_id", null).is("api_key_id", null).gte("day", firstDay)),
      noIncidents ? Promise.resolve(none) : mineIncidents(anyDb.from("incidents").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("status", "open")),
      noIncidents ? Promise.resolve(none) : mineIncidents(anyDb.from("incidents").select("created_at").eq("user_id", accountId).gte("created_at", since)),
      anyDb.from("pending_approvals").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("status", "pending"),
      anyDb.from("agents").select("id", { count: "exact", head: true }).eq("user_id", accountId),
      // GAP 10 (Unified UX): the trust score uses the same 90-day lookback and inputs GAP 4's per-entity trust score uses
      // (ControlEntities.tsx, useEntityTrustScore.ts). With a project it is that project's, so the calibration (account-wide) is left out.
      scoped ? Promise.resolve(none) : anyDb.from("confidence_calibration").select("calibration_gap").eq("user_id", accountId).is("api_key_id", null).gte("period_end", since90Days),
      mine(anyDb.from("agent_decisions").select("source").eq("user_id", accountId).eq("is_test", false).gte("created_at", since90Days).limit(10000)),
      mine(anyDb.from("agent_events").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("kind", "self_repair").gte("created_at", since90Days)),
      scoped ? Promise.resolve(none) : anyDb.from("outer_control_evaluations").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("verdict", "modify").gte("created_at", since90Days),
      agentId ? anyDb.from("ai_spend_caps").select("daily_cap_usd").eq("user_id", accountId).eq("agent_id", agentId).is("api_key_id", null).maybeSingle() : Promise.resolve(none),
    ]);

    // Coverage -- same definition ControlCoverageGaps.tsx uses: real,
    // connectable capabilities with no live (enabled, non-shadow) hard rule
    // matching them.
    const capabilities = ((statusRes.data?.capabilities ?? []) as { kind: string; provider: string; status: string }[])
      .filter((c) => c.status === "real")
      .map((c) => ({ kind: c.kind, provider: c.provider })) as CapabilityForCoverage[];
    const hardRules = rulesFor(project, (hardRulesRes.data ?? []) as (HardRuleForCoverage & { agent_id?: string | null })[]) as HardRuleForCoverage[];
    const safetyCount = rulesFor(project, (safetyRulesCountRes.data ?? []) as { agent_id?: string | null; api_key_id?: string | null }[]).length;
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
    // An agent's own cap when it has one, otherwise the account's.
    const ownCap = agentCapRes.data?.daily_cap_usd ?? spendCapRes.data?.daily_cap_usd ?? null;
    const cap = Number(ownCap ?? DEFAULT_CAP);
    const capIsCustom = ownCap !== null && ownCap !== undefined;
    const spendByDay = new Map(((spendDailyRes.data ?? []) as { day: string; cost_usd: number }[]).map((r) => [r.day, Number(r.cost_usd)]));
    setSpend({
      today: spendByDay.get(today) ?? 0,
      cap,
      capIsCustom,
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

    // With a project shown, it exists by definition: the last check is true.
    const projectExists = project ? true : (agentsCountRes.count ?? 0) > 0;
    setSetup({
      hardRules: hardRules.length > 0,
      safetyRules: safetyCount > 0,
      spendCapCustom: capIsCustom,
      agentDeployed: projectExists,
      pct: Math.round(([hardRules.length > 0, safetyCount > 0, capIsCustom, projectExists].filter(Boolean).length / 4) * 100),
    });

    // GAP 10 (Unified UX): the same computeTrustScore/computeGovernanceHealth
    // combination ControlEntities.tsx and GeneratedDashboard.tsx use per
    // entity, aggregated account-wide for this page's header indicator.
    const calibGaps = ((calibRes.data ?? []) as { calibration_gap: number | null }[]).map((r) => Math.abs(Number(r.calibration_gap) || 0));
    const avgCalibrationGap = calibGaps.length ? calibGaps.reduce((s, g) => s + g, 0) / calibGaps.length : null;
    const decisions90 = (decisions90Res.data ?? []) as { source: string | null }[];
    const ruleTriggered90 = decisions90.filter((d) => d.source === "hard_rule" || d.source === "safety_scanner").length;
    const trustScore = computeTrustScore({
      avgCalibrationGap,
      totalDecisions: decisions90.length,
      ruleTriggeredDecisions: ruleTriggered90,
      repairInterventions: (selfRepairRes.count ?? 0) + (modifyRes.count ?? 0),
    });
    // A website's trust score is the one stored with it when it was generated; an agent's and the account's are computed.
    const shownScore = isWebsite ? (project?.website?.trustScore ?? 100) : trustScore.score;
    setAccountTrustScore(isWebsite ? null : trustScore);
    setTrustScoreValue(shownScore);
    setAccountHealth(computeGovernanceHealth({
      trustScore: shownScore,
      rulesApplied: hardRules.length + safetyCount,
      spendPct: cap > 0 ? (spendByDay.get(today) ?? 0) / cap : null,
    }));

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, scopeKey]);

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
    accountTrustScore,
    accountHealth,
    trustScoreValue,
    refetch: () => setTick((t) => t + 1),
  };
}
