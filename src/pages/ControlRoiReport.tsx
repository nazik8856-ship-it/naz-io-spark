import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, TrendingUp, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { toast } from "@/hooks/use-toast";
import { buildRoiReport, projectMonthlySpend, type DecisionForRoi } from "@/lib/roi-report";
import { computeTrend } from "@/lib/trend";

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

type AgentOption = { id: string; name: string };
type ForecastRow = { label: string; projected: number };

/**
 * ROI REPORT — value-framed, distinct from the compliance report (audit-
 * framed). How many actions were blocked or modified before running as
 * proposed, how much ran autonomously vs. needed a human, what that
 * autonomy costs per decision, and a month-end spend projection at the
 * current daily rate.
 */
export default function ControlRoiReport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId } = useActiveAccount();
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [monthlyEmail, setMonthlyEmail] = useState(false);

  useEffect(() => {
    if (!user) return;
    anyDb.from("profiles").select("roi_report_monthly_enabled").eq("id", user.id).maybeSingle()
      .then(({ data }) => setMonthlyEmail(!!(data as { roi_report_monthly_enabled?: boolean } | null)?.roi_report_monthly_enabled));
  }, [user]);

  const toggleMonthlyEmail = async (checked: boolean) => {
    if (!user) return;
    setMonthlyEmail(checked);
    const { error } = await anyDb.from("profiles").update({ roi_report_monthly_enabled: checked }).eq("id", user.id);
    if (error) {
      setMonthlyEmail(!checked);
      toast({ title: "Couldn't save that", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: checked ? "Monthly email enabled" : "Monthly email turned off", description: checked ? "You'll get a summary on the 1st of each month." : undefined });
  };

  // Spend forecast is independent of the report's chosen date range -- it
  // always answers "at this month's pace so far, what will month-end look
  // like", so it loads on mount rather than waiting for Generate.
  const loadForecasts = useCallback(async () => {
    if (!accountId) return;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const daysElapsed = now.getUTCDate();
    const monthStartIso = monthStart.toISOString().slice(0, 10);

    const [{ data: accountRows }, { data: agentRows }, { data: agents }] = await Promise.all([
      anyDb.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).is("agent_id", null).gte("day", monthStartIso),
      anyDb.from("ai_spend_daily").select("agent_id, cost_usd").eq("user_id", accountId).not("agent_id", "is", null).gte("day", monthStartIso),
      anyDb.from("agents").select("id, name").eq("user_id", accountId),
    ]);

    const agentNames: Record<string, string> = {};
    for (const a of (agents ?? []) as AgentOption[]) agentNames[a.id] = a.name;

    const accountDaily = ((accountRows ?? []) as { cost_usd: number }[]).map((r) => Number(r.cost_usd) || 0);
    const rows: ForecastRow[] = [
      { label: "Account-wide", projected: projectMonthlySpend(accountDaily, daysElapsed, daysInMonth) },
    ];

    const perAgentDaily: Record<string, number[]> = {};
    for (const r of (agentRows ?? []) as { agent_id: string; cost_usd: number }[]) {
      (perAgentDaily[r.agent_id] ??= []).push(Number(r.cost_usd) || 0);
    }
    for (const [agentId, costs] of Object.entries(perAgentDaily)) {
      rows.push({ label: agentNames[agentId] ?? `Agent ${agentId.slice(0, 8)}…`, projected: projectMonthlySpend(costs, daysElapsed, daysInMonth) });
    }
    setForecasts(rows);
  }, [accountId]);

  useEffect(() => { void loadForecasts(); }, [loadForecasts]);

  const generate = async () => {
    if (!accountId) return;
    setGenerating(true);
    const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
    const rangeMs = new Date(toIso).getTime() - new Date(fromIso).getTime();
    const prevFromIso = new Date(new Date(fromIso).getTime() - rangeMs).toISOString();

    const [decisions, prevDecisions, accountSpend, prevAccountSpend, agentSpend, agents] = await Promise.all([
      anyDb.from("agent_decisions").select("decision, escalated, agent_id").eq("user_id", accountId).gte("created_at", fromIso).lte("created_at", toIso),
      anyDb.from("agent_decisions").select("id", { count: "exact", head: true }).eq("user_id", accountId).gte("created_at", prevFromIso).lt("created_at", fromIso),
      anyDb.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).is("agent_id", null).gte("day", from).lte("day", to),
      anyDb.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).is("agent_id", null).gte("day", prevFromIso.slice(0, 10)).lt("day", from),
      anyDb.from("ai_spend_daily").select("agent_id, cost_usd").eq("user_id", accountId).not("agent_id", "is", null).gte("day", from).lte("day", to),
      anyDb.from("agents").select("id, name").eq("user_id", accountId),
    ]);

    setGenerating(false);
    if (decisions.error || accountSpend.error || agentSpend.error) {
      toast({
        title: "Couldn't generate the report",
        description: decisions.error?.message || accountSpend.error?.message || agentSpend.error?.message,
        variant: "destructive",
      });
      return;
    }

    const agentNames: Record<string, string> = {};
    for (const a of (agents.data ?? []) as AgentOption[]) agentNames[a.id] = a.name;

    const spendByAgent: Record<string, number> = {};
    for (const r of (agentSpend.data ?? []) as { agent_id: string; cost_usd: number }[]) {
      spendByAgent[r.agent_id] = (spendByAgent[r.agent_id] ?? 0) + (Number(r.cost_usd) || 0);
    }

    const totalSpendUsd = ((accountSpend.data ?? []) as { cost_usd: number }[]).reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
    const prevSpendUsd = ((prevAccountSpend.data ?? []) as { cost_usd: number }[]).reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);

    const accountForecast = forecasts.find((f) => f.label === "Account-wide")?.projected ?? null;

    const report = buildRoiReport({
      from, to,
      generatedAt: new Date().toISOString(),
      decisions: (decisions.data ?? []) as DecisionForRoi[],
      totalSpendUsd,
      spendByAgent,
      agentNames,
      decisionsTrend: computeTrend((decisions.data ?? []).length, prevDecisions.count ?? 0),
      spendTrend: computeTrend(Math.round(totalSpendUsd * 100) / 100, Math.round(prevSpendUsd * 100) / 100),
      projectedMonthlySpendUsd: accountForecast,
    });
    setPreview(report);
  };

  const download = () => {
    if (!preview) return;
    const blob = new Blob([preview], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazai-roi-report_${from}_to_${to}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

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

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <TrendingUp className="h-5 w-5 text-emerald-400" /> ROI report
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          What the control system is worth: actions blocked or modified, how much ran autonomously, and
          what that costs — distinct from the compliance report's audit framing.
        </p>

        {forecasts.length > 0 && (
          <div className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Projected spend this month, at the current daily rate
            </div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-300">
              {forecasts.map((f) => (
                <li key={f.label} className="flex items-center gap-2">
                  <span className="text-zinc-400">{f.label}</span>
                  <span className="ml-auto font-mono">${f.projected.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-end gap-2 rounded border border-white/10 bg-white/[0.02] p-3">
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            To
            <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200" />
          </label>
          <button
            disabled={generating}
            onClick={generate}
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate report"}
          </button>
          {preview && (
            <button
              onClick={download}
              className="flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20"
            >
              <Download className="h-3.5 w-3.5" /> Download .md
            </button>
          )}
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
          <input type="checkbox" checked={monthlyEmail} onChange={(e) => void toggleMonthlyEmail(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-500" />
          Email me a summary of this on the 1st of every month
        </label>

        {preview && (
          <pre className="mt-6 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-4 text-xs text-zinc-300">
            {preview}
          </pre>
        )}
      </main>
    </div>
  );
}
