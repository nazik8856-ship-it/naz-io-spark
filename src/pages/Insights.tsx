import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Sparkles, TrendingUp, Lightbulb, GitBranch } from "lucide-react";

type Insight = {
  id: string;
  insight: string;
  kind: string;
  confidence: string;
  evidence_count: number;
  first_observed_at: string;
  last_confirmed_at: string;
};

const kindIcon = (kind: string) => {
  if (kind === "correlation") return <GitBranch className="w-3.5 h-3.5" />;
  if (kind === "lesson") return <Lightbulb className="w-3.5 h-3.5" />;
  return <TrendingUp className="w-3.5 h-3.5" />;
};

const confidenceColor = (c: string) =>
  c === "high" ? "#34d399" : c === "medium" ? "#fbbf24" : "#fb7185";

export default function Insights() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("org_insights")
      .select("id, insight, kind, confidence, evidence_count, first_observed_at, last_confirmed_at")
      .eq("user_id", user.id)
      .order("evidence_count", { ascending: false })
      .order("last_confirmed_at", { ascending: false })
      .limit(50);
    setRows((data as Insight[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-org-insights", { body: {} });
      if (error) throw error;
      const d = data as { inserted?: number; updated?: number; reason?: string };
      if (d.reason === "not_enough_signal") setMsg("Not enough activity yet — run a few agents first.");
      else if (d.reason === "no_insights_extracted") setMsg("No clear patterns yet. Try again after more real runs.");
      else setMsg(`Learned ${d.inserted ?? 0} new · reinforced ${d.updated ?? 0}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen text-white" style={{ background: "#020617" }}>
      <div className="max-w-4xl mx-auto px-6 py-10">
        <Link to="/generator-home" className="inline-flex items-center gap-2 text-white/50 hover:text-white text-sm mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <div className="flex items-start justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-[#00A3FF]" />
              <h1 className="text-2xl font-semibold tracking-tight">What NazAI has learned about your business</h1>
            </div>
            <p className="text-sm text-white/50 max-w-2xl">
              Patterns, correlations, and lessons extracted from your agents' real execution history. Injected as context into every agent run.
            </p>
          </div>
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border border-[#00A3FF]/40 bg-[#00A3FF]/10 hover:bg-[#00A3FF]/20 text-[#7cc8ff] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? "animate-spin" : ""}`} />
            {analyzing ? "Analyzing…" : "Analyze now"}
          </button>
        </div>

        {msg && (
          <div className="mb-5 text-xs text-white/60 px-3 py-2 rounded-md border border-white/10 bg-white/5">
            {msg}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-white/40">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
            <div className="text-sm text-white/60 mb-2">No insights yet</div>
            <div className="text-xs text-white/40">Once your agents run real tasks, click "Analyze now" to extract patterns.</div>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/50 font-mono">
                        {kindIcon(r.kind)} {r.kind}
                      </span>
                      <span
                        className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border"
                        style={{
                          color: confidenceColor(r.confidence),
                          borderColor: `${confidenceColor(r.confidence)}55`,
                          background: `${confidenceColor(r.confidence)}14`,
                        }}
                      >
                        {r.confidence}
                      </span>
                    </div>
                    <div className="text-[13.5px] text-white/90 leading-relaxed">{r.insight}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] text-white/40 font-mono">evidence</div>
                    <div className="text-lg font-semibold text-white/90 tabular-nums">{r.evidence_count}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[10px] text-white/30 font-mono">
                  <span>first seen {new Date(r.first_observed_at).toLocaleDateString()}</span>
                  <span>·</span>
                  <span>last confirmed {new Date(r.last_confirmed_at).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
