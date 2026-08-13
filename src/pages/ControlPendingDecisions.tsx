import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

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

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("agent_decisions")
      .select("id,decision,reasoning,confidence_score,escalated,source,agent_id,agent_run_id,human_response,created_at")
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

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            Nothing is waiting on you.
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
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-white/5 align-top">
                  <td className="py-3 pr-3 font-mono text-[11px] text-zinc-500">
                    {new Date(row.created_at).toLocaleString()}
                    <div className="text-zinc-600">{row.source}</div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-[11px] uppercase text-zinc-300">
                    {row.decision}
                    {row.escalated && <div className="text-amber-400">escalated</div>}
                  </td>
                  <td className="py-3 pr-3 text-zinc-300">{row.reasoning}</td>
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
