import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Activity, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { pctOf, alertDeliverySplit, isTrendingDown, gateLatencyStats, isAuditIntegritySweepFailing, type GateLatencyStats, type AuditIntegrityRunSummary } from "@/lib/control-health";
import { computeSlaStats, type SlaStats } from "@/lib/approval-sla";
import { actorName, buildActorNameMap } from "@/lib/actor-names";
import { classifyAnomalyCoverage } from "@/lib/anomaly-coverage";

// gate_duration_ms and audit_integrity_runs (2026-08-23) aren't in the
// generated types.ts yet -- same stale-types workaround every page touching
// a recent column already uses (see ControlCoverageGaps.tsx).
const anyDb = supabase as any;

const WINDOW_DAYS = 30;

type Stat = { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" };

function StatCard({ stat }: { stat: Stat }) {
  const toneClass =
    stat.tone === "bad" ? "border-rose-500/40 bg-rose-500/[0.04]" :
    stat.tone === "warn" ? "border-amber-500/40 bg-amber-500/[0.04]" :
    "border-white/10 bg-white/[0.02]";
  return (
    <div className={`rounded border p-4 ${toneClass}`}>
      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{stat.label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{stat.value}</div>
      {stat.sub && <div className="mt-1 text-xs text-zinc-500">{stat.sub}</div>}
    </div>
  );
}

/**
 * INTERNAL CONTROL-PLANE HEALTH — an ops-facing view of the control
 * system's own reliability: how often the gate itself fails, whether
 * alerts are actually getting delivered, breaker/incident state, and the
 * weekly self-audit trend. Reads directly from tables the gate and its
 * supporting jobs already write — no new backend endpoint.
 */
export default function ControlHealthView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [gateErrorPct, setGateErrorPct] = useState(0);
  const [gateErrorCount, setGateErrorCount] = useState(0);
  const [totalDecisions, setTotalDecisions] = useState(0);
  const [alertSplit, setAlertSplit] = useState({ slack: 0, log: 0, total: 0, slackPct: 100 });
  const [trippedBreakers, setTrippedBreakers] = useState<{ action_type: string; failure_rate: number; trip_count: number }[]>([]);
  const [testRuns, setTestRuns] = useState<{ pass_rate_pct: number; created_at: string; regressions: unknown[] }[]>([]);
  const [openIncidents, setOpenIncidents] = useState(0);
  const [sla, setSla] = useState<{ byRiskTier: Record<string, SlaStats>; byApprover: Record<string, SlaStats> }>({ byRiskTier: {}, byApprover: {} });
  const [names, setNames] = useState<Record<string, string>>({});
  const [gateLatency, setGateLatency] = useState<GateLatencyStats>({ avgMs: 0, p95Ms: 0, count: 0 });
  const [anomalyCoverage, setAnomalyCoverage] = useState<{ pct: number; severity: "none" | "low" | "moderate" | "high" }>({ pct: 0, severity: "none" });
  const [latestAuditRun, setLatestAuditRun] = useState<AuditIntegrityRunSummary>(null);
  const [correlatedTripCount, setCorrelatedTripCount] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [decisions, alerts, breakers, runs, incidents, resolvedApprovals, members, anomalyTotalRes, anomalyAgentlessRes, auditRunRes, correlatedRes] = await Promise.all([
      anyDb.from("agent_decisions").select("source, gate_duration_ms").eq("user_id", user.id).gte("created_at", since),
      supabase.from("critical_alerts").select("delivered_via").eq("user_id", user.id).gte("created_at", since),
      supabase.from("circuit_breakers").select("action_type, tripped, failure_rate, trip_count").eq("user_id", user.id).eq("tripped", true),
      supabase.from("control_test_runs").select("pass_rate_pct, created_at, regressions").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("incidents").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "open"),
      supabase.from("pending_approvals").select("risk_tier, resolved_by, created_at, resolved_at").eq("user_id", user.id).not("resolved_at", "is", null).gte("created_at", since),
      supabase.from("account_members").select("member_id, email").eq("account_owner_id", user.id).eq("status", "active"),
      anyDb.from("agent_decisions").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since),
      anyDb.from("agent_decisions").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since).is("agent_id", null),
      anyDb.from("audit_integrity_runs").select("mismatched_count, unsigned, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
      anyDb.from("incidents").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "open").eq("kind", "correlated_breaker_trip"),
    ]);

    const decisionRows = (decisions.data ?? []) as { source: string; gate_duration_ms: number | null }[];
    const total = decisionRows.length;
    const gateErrors = decisionRows.filter((d) => d.source === "gate_error").length;
    setTotalDecisions(total);
    setGateErrorCount(gateErrors);
    setGateErrorPct(pctOf(gateErrors, total));
    setGateLatency(gateLatencyStats(
      decisionRows.map((d) => d.gate_duration_ms).filter((v): v is number => typeof v === "number"),
    ));

    setAlertSplit(alertDeliverySplit((alerts.data ?? []) as { delivered_via: "slack" | "log" }[]));
    setTrippedBreakers((breakers.data ?? []) as { action_type: string; failure_rate: number; trip_count: number }[]);
    setTestRuns((runs.data ?? []) as { pass_rate_pct: number; created_at: string; regressions: unknown[] }[]);
    setOpenIncidents(incidents.count ?? 0);
    setSla(computeSlaStats((resolvedApprovals.data ?? []) as { risk_tier: string; resolved_by: string | null; created_at: string; resolved_at: string }[]));
    setNames(buildActorNameMap(user.id, (members.data ?? []) as { member_id: string | null; email: string }[]));
    setAnomalyCoverage(classifyAnomalyCoverage(anomalyTotalRes.count ?? 0, anomalyAgentlessRes.count ?? 0));
    const latestRun = (auditRunRes.data ?? [])[0] as AuditIntegrityRunSummary | undefined;
    setLatestAuditRun(latestRun ?? null);
    setCorrelatedTripCount(correlatedRes.count ?? 0);

    if (decisions.error || alerts.error || breakers.error || runs.error || incidents.error) {
      toast({ title: "Some data didn't load", description: "Refresh to try again.", variant: "destructive" });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const trendingDown = isTrendingDown(testRuns);

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Activity className="h-5 w-5 text-cyan-400" /> Control-plane health
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          How the control system itself is doing — not your agents. Last {WINDOW_DAYS} days unless noted.
        </p>

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                stat={{
                  label: "Gate error rate",
                  value: `${gateErrorPct}%`,
                  sub: `${gateErrorCount} of ${totalDecisions} decisions`,
                  tone: gateErrorCount > 0 ? "bad" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Alert delivery",
                  value: `${alertSplit.slackPct}% Slack`,
                  sub: alertSplit.total > 0 ? `${alertSplit.slack} Slack · ${alertSplit.log} log-only` : "No alerts fired",
                  tone: alertSplit.total > 0 && alertSplit.log > 0 ? "warn" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Open incidents",
                  value: String(openIncidents),
                  tone: openIncidents > 0 ? "warn" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Tripped breakers",
                  value: String(trippedBreakers.length),
                  sub: trippedBreakers.map((b) => b.action_type).join(", ") || undefined,
                  tone: trippedBreakers.length > 0 ? "bad" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Latest self-audit",
                  value: testRuns.length ? `${testRuns[0].pass_rate_pct}%` : "—",
                  sub: testRuns.length ? new Date(testRuns[0].created_at).toLocaleDateString() : "No runs yet",
                  tone: testRuns.length && testRuns[0].pass_rate_pct < 100 ? "warn" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Self-audit trend",
                  value: trendingDown ? "Down" : "Stable/up",
                  tone: trendingDown ? "bad" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Gate latency",
                  value: gateLatency.count ? `${gateLatency.avgMs}ms avg` : "—",
                  sub: gateLatency.count ? `p95 ${gateLatency.p95Ms}ms · ${gateLatency.count} timed` : "No timing data yet",
                  tone: gateLatency.count && gateLatency.p95Ms > 1000 ? "warn" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Anomaly coverage",
                  value: `${anomalyCoverage.pct}% agentless`,
                  sub: `Severity: ${anomalyCoverage.severity}`,
                  tone: anomalyCoverage.severity === "high" ? "bad" : anomalyCoverage.severity === "moderate" || anomalyCoverage.severity === "low" ? "warn" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Audit integrity",
                  value: latestAuditRun ? (isAuditIntegritySweepFailing(latestAuditRun) ? "Failing" : "Passing") : "No runs yet",
                  sub: latestAuditRun
                    ? `${latestAuditRun.mismatched_count} mismatch(es) · ${latestAuditRun.unsigned} unsigned · ${new Date(latestAuditRun.created_at).toLocaleDateString()}`
                    : undefined,
                  tone: !latestAuditRun ? "ok" : isAuditIntegritySweepFailing(latestAuditRun) ? "bad" : "ok",
                }}
              />
              <StatCard
                stat={{
                  label: "Correlated breaker trips",
                  value: String(correlatedTripCount),
                  sub: "Open incidents, fleet-wide",
                  tone: correlatedTripCount > 0 ? "bad" : "ok",
                }}
              />
            </div>

            {testRuns.length > 0 && (
              <div className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {trendingDown ? <TrendingDown className="h-3.5 w-3.5 text-rose-400" /> : <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />}
                  Recent self-audit runs
                </div>
                <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                  {testRuns.map((r, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-16 font-mono text-zinc-500">{new Date(r.created_at).toLocaleDateString()}</span>
                      <span className={r.pass_rate_pct < 100 ? "text-amber-300" : "text-emerald-300"}>{r.pass_rate_pct}%</span>
                      {Array.isArray(r.regressions) && r.regressions.length > 0 && (
                        <span className="text-rose-300">· {r.regressions.length} regression(s)</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(Object.keys(sla.byRiskTier).length > 0 || Object.keys(sla.byApprover).length > 0) && (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded border border-white/10 bg-white/[0.02] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Approval SLA by risk tier</div>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                    {Object.entries(sla.byRiskTier).map(([tier, s]) => (
                      <li key={tier} className="flex items-center gap-2">
                        <span className="w-16 font-mono uppercase text-zinc-500">{tier}</span>
                        <span>median {s.medianHours.toFixed(1)}h</span>
                        <span className="text-zinc-500">· p90 {s.p90Hours.toFixed(1)}h</span>
                        <span className="ml-auto text-zinc-600">{s.count} resolved</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded border border-white/10 bg-white/[0.02] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Approval SLA by approver</div>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                    {Object.entries(sla.byApprover).map(([uid, s]) => (
                      <li key={uid} className="flex items-center gap-2">
                        <span className="w-24 truncate font-mono text-zinc-400">{actorName(names, uid)}</span>
                        <span>median {s.medianHours.toFixed(1)}h</span>
                        <span className="text-zinc-500">· p90 {s.p90Hours.toFixed(1)}h</span>
                        <span className="ml-auto text-zinc-600">{s.count} resolved</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
