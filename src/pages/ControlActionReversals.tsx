import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Undo2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { toCsv } from "@/lib/csv";
import { filterBySearch } from "@/lib/search-filter";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { extractFunctionErrorMessage } from "@/lib/supabase-function-error";

// Stale generated types: action_reversals isn't in types.ts yet.
const anyDb = supabase as any;

type ReversalRow = {
  id: string;
  decision_id: string | null;
  agent_id: string | null;
  provider: string | null;
  tool: string;
  reversible: boolean;
  undo_kind: string;
  undo_effect: string | null;
  irreversible_reason: string | null;
  status: string;
  summary: string | null;
  error: string | null;
  executed_at: string | null;
  created_at: string;
};

type AgentOption = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  available: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10",
  undone: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  failed: "text-rose-300 border-rose-500/40 bg-rose-500/10",
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * ACTION REVERSALS — the execution-level undo audit trail. Every action an
 * agent actually carried out (not just decided on) that has a real undo
 * mechanism wired to it gets a row here (see control-engine's /undo route
 * and _shared/reversibility.ts). This is the "was it reversed, and can it
 * still be?" complement to Decision History's "why was it decided?" — the
 * two questions a real explainability pillar needs to answer, and this one
 * previously had a fully working backend (control-engine's own /undo
 * endpoint) with no operator-facing UI at all.
 */
export default function ControlActionReversals() {
  const navigate = useNavigate();
  const { accountId } = useActiveAccount();
  const [rows, setRows] = useState<ReversalRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "undone" | "failed">("all");
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [exporting, setExporting] = useState(false);

  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? "Unknown agent" : "—");

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
    let query = anyDb
      .from("action_reversals")
      .select("id, decision_id, agent_id, provider, tool, reversible, undo_kind, undo_effect, irreversible_reason, status, summary, error, executed_at, created_at")
      .eq("user_id", accountId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);

    const [{ data, error }, { data: agentRows }] = await Promise.all([
      query,
      supabase.from("agents").select("id, name").eq("user_id", accountId),
    ]);
    setLoading(false);
    if (error) {
      toast({ title: "Couldn't load action reversals", description: error.message, variant: "destructive" });
      return;
    }
    setRows((data ?? []) as ReversalRow[]);
    setAgents((agentRows ?? []) as AgentOption[]);
  }, [accountId, statusFilter, from, to]);

  useEffect(() => { load(); }, [load]);

  const visibleRows = filterBySearch(rows, search, ["tool", "provider", "summary", "error", "undo_kind"]);

  const undo = async (row: ReversalRow) => {
    if (!row.decision_id) return;
    setBusy(row.id);
    const { data, error } = await supabase.functions.invoke(`control-engine/undo/${row.decision_id}`, { body: {} });
    setBusy(null);
    const res = (data ?? {}) as { ok?: boolean; message?: string; summary?: string; already_undone?: boolean };
    if (error && !res.message) {
      const detail = (await extractFunctionErrorMessage(error)) ?? "Couldn't run the undo.";
      toast({ title: "Undo failed", description: detail, variant: "destructive" });
      return;
    }
    toast({
      title: res.ok || res.already_undone ? "Undone" : "Couldn't undo it",
      description: res.summary || res.message || "",
      variant: res.ok || res.already_undone ? undefined : "destructive",
    });
    load();
  };

  const exportCsv = async () => {
    if (!accountId) return;
    setExporting(true);
    const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
    const { data, error } = await anyDb
      .from("action_reversals")
      .select("id, decision_id, agent_id, provider, tool, reversible, undo_kind, status, summary, error, executed_at, created_at")
      .eq("user_id", accountId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .limit(10000);
    setExporting(false);
    if (error) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
      return;
    }
    const exportRows = (data ?? []) as ReversalRow[];
    if (!exportRows.length) {
      toast({ title: "Nothing to export", description: `No action reversals between ${from} and ${to}.` });
      return;
    }
    const csv = toCsv(exportRows, [
      { key: "created_at", header: "Recorded (UTC)" },
      { key: "executed_at", header: "Undone at (UTC)" },
      { key: "tool", header: "Tool" },
      { key: "provider", header: "Provider" },
      { key: "reversible", header: "Reversible" },
      { key: "undo_kind", header: "Undo kind" },
      { key: "status", header: "Status" },
      { key: "summary", header: "Summary" },
      { key: "error", header: "Error" },
      { key: "decision_id", header: "Decision ID" },
      { key: "agent_id", header: "Agent ID" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazai-action-reversals_${from}_to_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${exportRows.length} row${exportRows.length === 1 ? "" : "s"} written to CSV.` });
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

      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Undo2 className="h-5 w-5 text-cyan-300" /> Action reversals
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every executed action with a real undo mechanism wired to it — whether it's still reversible, already undone, or why it can't be.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2 rounded border border-white/10 bg-white/[0.02] p-3">
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
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200">
              <option value="all">All</option>
              <option value="available">Available (not yet undone)</option>
              <option value="undone">Undone</option>
              <option value="failed">Undo failed</option>
            </select>
          </label>
          <button
            disabled={exporting}
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tool, provider, summary, or error…"
          className="mt-3 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
        />

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : visibleRows.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            {rows.length === 0 ? "No executed actions with an undo record in range." : "No rows match that search."}
          </p>
        ) : (
          <table className="mt-6 w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Undo</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="border-b border-white/5 align-top">
                  <td className="py-3 pr-3 font-mono text-[11px] text-zinc-500">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-mono text-[11px] uppercase text-zinc-300">
                      {row.tool}{row.provider ? ` · ${row.provider}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {row.status === "failed" && row.error
                        ? row.error
                        : row.summary || (row.reversible ? "Reversible" : row.irreversible_reason || "Not reversible")}
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-[11px] text-cyan-300">{agentName(row.agent_id)}</td>
                  <td className="py-3 pr-3">
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${STATUS_STYLE[row.status] ?? "text-zinc-400 border-white/15 bg-white/5"}`}>
                      {row.status}
                    </span>
                    {!row.reversible && row.status === "available" && (
                      <div className="mt-1 font-mono text-[10px] uppercase text-zinc-500">not reversible</div>
                    )}
                  </td>
                  <td className="py-3">
                    {row.reversible && row.status === "available" && row.decision_id ? (
                      <button
                        disabled={busy === row.id}
                        onClick={() => undo(row)}
                        className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] uppercase text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> {busy === row.id ? "Undoing…" : "Undo"}
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
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
