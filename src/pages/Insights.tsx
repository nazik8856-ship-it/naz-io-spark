import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Sparkles, TrendingUp, Lightbulb, GitBranch, FlaskConical, Send, ChevronDown, ChevronRight } from "lucide-react";

type Insight = {
  id: string;
  insight: string;
  kind: string;
  confidence: string;
  evidence_count: number;
  first_observed_at: string;
  last_confirmed_at: string;
};

type ScenarioResponse = {
  analysis: string;
  key_factors_considered: string[];
  confidence: "high" | "medium" | "low";
  caveats: string[];
};

type Simulation = {
  id: string;
  question: string;
  response: ScenarioResponse;
  created_at: string;
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

  const [question, setQuestion] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [sims, setSims] = useState<Simulation[]>([]);
  const [openSim, setOpenSim] = useState<string | null>(null);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const [{ data: insData }, { data: simData }] = await Promise.all([
      supabase
        .from("org_insights")
        .select("id, insight, kind, confidence, evidence_count, first_observed_at, last_confirmed_at")
        .eq("user_id", user.id)
        .order("evidence_count", { ascending: false })
        .order("last_confirmed_at", { ascending: false })
        .limit(50),
      supabase
        .from("scenario_simulations")
        .select("id, question, response, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setRows((insData as Insight[]) || []);
    setSims(((simData as unknown) as Simulation[]) || []);
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

  const runSimulation = async () => {
    const q = question.trim();
    if (q.length < 5) { setSimError("Ask a slightly longer question."); return; }
    setSimulating(true);
    setSimError(null);
    try {
      const { data, error } = await supabase.functions.invoke("simulate-scenario", { body: { question: q } });
      if (error) throw error;
      const d = data as { id: string; created_at: string; question: string; response: ScenarioResponse };
      setSims((prev) => [{ id: d.id, question: d.question, response: d.response, created_at: d.created_at }, ...prev]);
      setOpenSim(d.id);
      setQuestion("");
    } catch (e) {
      setSimError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setSimulating(false);
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

        {/* Digital Twin — scenario simulation */}
        <section className="mb-10 rounded-2xl border border-[#00A3FF]/25 bg-gradient-to-b from-[#00A3FF]/[0.06] to-transparent p-5">
          <div className="flex items-center gap-2 mb-1.5">
            <FlaskConical className="w-4 h-4 text-[#00A3FF]" />
            <h2 className="text-sm font-semibold tracking-tight">Digital Twin · Ask a what-if question</h2>
          </div>
          <p className="text-xs text-white/50 mb-3">
            Analysis only — never runs real actions. Answers use your actual agent data, clients, insights, and history.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !simulating) runSimulation(); }}
              placeholder='e.g. "What if we raise prices 10%?" or "What if I add a second outreach agent?"'
              className="flex-1 bg-black/40 border border-white/10 focus:border-[#00A3FF]/60 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none"
              disabled={simulating}
            />
            <button
              onClick={runSimulation}
              disabled={simulating || question.trim().length < 5}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium bg-[#00A3FF] hover:bg-[#0093eb] text-black disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className={`w-3.5 h-3.5 ${simulating ? "animate-pulse" : ""}`} />
              {simulating ? "Simulating…" : "Simulate"}
            </button>
          </div>
          {simError && (
            <div className="mt-3 text-xs text-rose-300 px-3 py-2 rounded-md border border-rose-400/30 bg-rose-400/5">
              {simError}
            </div>
          )}

          {sims.length > 0 && (
            <ul className="mt-5 space-y-2.5">
              {sims.map((s) => {
                const isOpen = openSim === s.id;
                const conf = s.response?.confidence ?? "low";
                return (
                  <li key={s.id} className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                    <button
                      onClick={() => setOpenSim(isOpen ? null : s.id)}
                      className="w-full flex items-start gap-3 p-3.5 text-left hover:bg-white/[0.03]"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 mt-0.5 text-white/40 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-white/40 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-white/90 font-medium truncate">{s.question}</div>
                        <div className="text-[10px] text-white/40 font-mono mt-0.5">
                          {new Date(s.created_at).toLocaleString()}
                        </div>
                      </div>
                      <span
                        className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border shrink-0"
                        style={{
                          color: confidenceColor(conf),
                          borderColor: `${confidenceColor(conf)}55`,
                          background: `${confidenceColor(conf)}14`,
                        }}
                      >
                        {conf}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/5">
                        <div className="text-[13px] text-white/85 whitespace-pre-wrap leading-relaxed">
                          {s.response?.analysis}
                        </div>
                        {s.response?.key_factors_considered?.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono mb-1.5">Factors considered</div>
                            <ul className="space-y-1">
                              {s.response.key_factors_considered.map((f, i) => (
                                <li key={i} className="text-[12px] text-white/70 flex gap-2">
                                  <span className="text-[#00A3FF]/70">▸</span><span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {s.response?.caveats?.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-amber-300/70 font-mono mb-1.5">Caveats</div>
                            <ul className="space-y-1">
                              {s.response.caveats.map((c, i) => (
                                <li key={i} className="text-[12px] text-amber-100/80 flex gap-2">
                                  <span className="text-amber-300/60">!</span><span>{c}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

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
