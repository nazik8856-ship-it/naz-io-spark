import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X, ChevronDown, ChevronRight, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { toCsv } from "@/lib/csv";
import { filterBySearch } from "@/lib/search-filter";
import { GateTraceList, type TraceEntry } from "@/components/control/GateTraceList";

type DecisionRow = {
  id: string;
  decision: string;
  reasoning: string;
  confidence_score: number;
  escalated: boolean;
  source: string;
  agent_id: string | null;
  agent_run_id: string | null;
  human_response: string | null;
  created_at: string;
  gate_trace: TraceEntry[] | null;
};

const CONFIDENCE_BAR = 60;

/**
 * PENDING DECISIONS — decisions the AI logged that still need a human answer:
 * escalated items and low-confidence calls with no recorded response yet.
 */
export default function ControlPendingDecisions() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const filteredRows = filterBySearch(rows, search, ["decision", "reasoning", "source"]);

  const toggleTrace = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("agent_decisions")
      .select("id,decision,reasoning,confidence_score,escalated,source,agent_id,agent_run_id,human_response,created_at,gate_trace")
      .eq("user_id", user.id)
      .is("human_response", null)
      // Deferred "not a fit" verdicts are included too: overriding one is the
      // signal the fit/value learning loop measures against real outcomes.
      .or(`escalated.eq.true,confidence_score.lt.${CONFIDENCE_BAR},decision.ilike.DEFERRED%`)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast({ title: "Couldn't load decisions", description: error.message, variant: "destructive" });
    setRows((data ?? []) as DecisionRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const respond = async (row: DecisionRow, response: "allowed" | "rejected") => {
    setBusy(row.id);
    const { error } = await supabase
      .from("agent_decisions")
      .update({ human_response: response })
      .eq("id", row.id);
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't record that", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: response === "allowed" ? "Allowed" : "Rejected", description: "Response recorded on the decision." });
    setRows((r) => r.filter((x) => x.id !== row.id));
  };

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const daysAgoIso = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [exportFrom, setExportFrom] = useState(daysAgoIso(30));
  const [exportTo, setExportTo] = useState(todayIso());
  const [exporting, setExporting] = useState(false);

  // Full audit-log export — every decision in the range, not just the
  // pending ones the table above shows. The first thing any compliance-
  // minded customer asks for: a real CSV they can hand to an auditor.
  const exportCsv = async () => {
    if (!user) return;
    setExporting(true);
    const fromIso = new Date(`${exportFrom}T00:00:00.000Z`).toISOString();
    const toIso = new Date(`${exportTo}T23:59:59.999Z`).toISOString();
    const { data, error } = await supabase
      .from("agent_decisions")
      .select("id,decision,reasoning,confidence_score,escalated,source,agent_id,agent_run_id,human_response,created_at,policy_version")
      .eq("user_id", user.id)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .limit(10000);
    setExporting(false);
    if (error) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
      return;
    }
    const rows = (data ?? []) as (DecisionRow & { policy_version: number | null })[];
    if (!rows.length) {
      toast({ title: "Nothing to export", description: `No decisions between ${exportFrom} and ${exportTo}.` });
      return;
    }
    const csv = toCsv(rows, [
      { key: "created_at", header: "Timestamp (UTC)" },
      { key: "decision", header: "Decision" },
      { key: "source", header: "Source" },
      { key: "escalated", header: "Escalated" },
      { key: "confidence_score", header: "Confidence %" },
      { key: "reasoning", header: "Reasoning" },
      { key: "human_response", header: "Human Response" },
      { key: "policy_version", header: "Policy Version" },
      { key: "agent_id", header: "Agent ID" },
      { key: "agent_run_id", header: "Run ID" },
      { key: "id", header: "Decision ID" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazai-control-audit-log_${exportFrom}_to_${exportTo}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${rows.length} decision${rows.length === 1 ? "" : "s"} written to CSV.` });
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

      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <h1 className="text-xl font-semibold">Pending approvals</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Decisions waiting on a human answer: escalated items and anything scored under {CONFIDENCE_BAR}% confidence.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2 rounded border border-white/10 bg-white/[0.02] p-3">
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            From
            <input
              type="date"
              value={exportFrom}
              max={exportTo}
              onChange={(e) => setExportFrom(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            To
            <input
              type="date"
              value={exportTo}
              min={exportFrom}
              max={todayIso()}
              onChange={(e) => setExportTo(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200"
            />
          </label>
          <button
            disabled={exporting}
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export audit log (CSV)"}
          </button>
          <span className="text-[10px] text-zinc-500">Every decision in range, not just pending ones.</span>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search decision, reasoning, or source…"
          className="mt-3 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
        />

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : filteredRows.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            {rows.length === 0 ? "Nothing is waiting on you." : "No decisions match that search."}
          </p>
        ) : (
          <table className="mt-6 w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Verdict</th>
                <th className="py-2 pr-3">Reasoning</th>
                <th className="py-2 pr-3">Confidence</th>
                <th className="py-2">Response</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-b border-white/5 align-top">
                  <td className="py-3 pr-3 font-mono text-[11px] text-zinc-500">
                    {new Date(row.created_at).toLocaleString()}
                    <div className="text-zinc-600">{row.source}</div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-[11px] uppercase text-zinc-300">
                    {row.decision}
                    {row.escalated && <div className="text-amber-400">escalated</div>}
                  </td>
                  <td className="py-3 pr-3 text-zinc-300">
                    {row.reasoning}
                    {row.gate_trace && row.gate_trace.length > 0 && (
                      <>
                        <button
                          onClick={() => toggleTrace(row.id)}
                          className="mt-1 flex items-center gap-1 font-mono text-[10px] uppercase text-zinc-500 hover:text-zinc-300"
                        >
                          {expanded.has(row.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          Why
                        </button>
                        {expanded.has(row.id) && <GateTraceList trace={row.gate_trace} />}
                      </>
                    )}
                  </td>
                  <td className="py-3 pr-3 font-mono text-[11px] text-zinc-400">{row.confidence_score}%</td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <button
                        disabled={busy === row.id}
                        onClick={() => respond(row, "allowed")}
                        className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" /> Allow
                      </button>
                      <button
                        disabled={busy === row.id}
                        onClick={() => respond(row, "rejected")}
                        className="flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 font-mono text-[11px] uppercase text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
