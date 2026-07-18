import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Globe, Building2, ShoppingBag, Palette, Code2, FileText, Zap, Clock, ChevronRight, Sparkles, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import PromptExtras, { analyzeAndBuildContext, type Attachment } from "@/components/generator/PromptExtras";

const TYPES = [
  { id: "website", label: "Website", icon: Globe },
  { id: "business", label: "AI Agent", icon: Building2 },
  { id: "store", label: "Store", icon: ShoppingBag },
  { id: "landing", label: "Landing", icon: Palette },
  { id: "app", label: "App", icon: Code2 },
  { id: "document", label: "Document", icon: FileText },
];

export default function GeneratorHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { recentProjects, loading } = useProjects(user?.id);
  const [prompt, setPrompt] = useState("");
  const [activeType, setActiveType] = useState("website");

  // Recent AI Agents — surfaced here (previously shown inside the generation
  // workspace's "Your Agents" tab). Everything the user has generated lands in
  // this Recent section now.
  type RecentAgent = { id: string; name: string; goal: string | null; created_at: string; schedule_cron: string | null };
  const [recentAgents, setRecentAgents] = useState<RecentAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  type Outcome = { label: string; tone: "green" | "amber" | "red" | "zinc" };
  type RunOutcome = { runId: string; outcome: Outcome; time: string };
  const [agentOutcomes, setAgentOutcomes] = useState<Record<string, Outcome>>({});
  // Last 7 scheduled runs per agent (cron-scheduled agents only).
  const [agentRunHistory, setAgentRunHistory] = useState<Record<string, RunOutcome[]>>({});
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setAgentsLoading(true);
      const { data } = await supabase
        .from("agents")
        .select("id, name, goal, created_at, schedule_cron")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(6);
      if (cancelled) return;
      const agents = (data as RecentAgent[]) || [];
      setRecentAgents(agents);
      setAgentsLoading(false);

      // Derive plain outcome per agent from its latest run's actual events.
      const ids = agents.map((a) => a.id);
      if (ids.length === 0) return;
      const { data: evs } = await supabase
        .from("agent_events")
        .select("agent_id, run_id, kind, payload, created_at")
        .in("agent_id", ids)
        .order("created_at", { ascending: false })
        .limit(1200);
      if (cancelled || !evs) return;

      const byAgent = new Map<string, typeof evs>();
      for (const e of evs) {
        const list = byAgent.get(e.agent_id as string) || [];
        list.push(e);
        byAgent.set(e.agent_id as string, list);
      }

      // Compute outcome for a set of events within a single run (chronological).
      const computeOutcome = (runEvs: typeof evs): Outcome => {
        let hasPendingApproval = false;
        let hasClarification = false;
        const lastActionOkByType = new Map<string, boolean>();
        let sawAction = false;
        for (const e of runEvs) {
          const kind = String(e.kind || "");
          const p = (e.payload as Record<string, unknown>) || {};
          if (kind === "pending_approval") { hasPendingApproval = true; continue; }
          if (kind === "approval_resolved" || kind === "approved" || kind === "rejected") { hasPendingApproval = false; continue; }
          if (kind === "ask_user" || kind === "clarification" || kind === "needs_input") { hasClarification = true; continue; }
          if (kind === "clarification_resolved" || kind === "user_reply") { hasClarification = false; continue; }
          if (kind === "action") {
            sawAction = true;
            const type = String((p as { type?: unknown }).type || "action");
            const ok = (p as { ok?: unknown }).ok === true;
            lastActionOkByType.set(type, ok);
          }
        }
        if (hasPendingApproval) return { label: "Needs approval", tone: "amber" };
        if (hasClarification) return { label: "Blocked", tone: "amber" };
        if (sawAction && Array.from(lastActionOkByType.values()).some((v) => v === false)) return { label: "Failed", tone: "red" };
        if (sawAction) return { label: "Done", tone: "green" };
        return { label: "Running", tone: "zinc" };
      };

      const outcomes: Record<string, Outcome> = {};
      const history: Record<string, RunOutcome[]> = {};
      const cronById = new Map(agents.map((a) => [a.id, a.schedule_cron]));

      for (const [aid, list] of byAgent) {
        // Group by run_id, tracking earliest time per run for chronological ordering.
        const runs = new Map<string, { evs: typeof evs; firstAt: string }>();
        for (const e of list) {
          const rid = e.run_id as string | null;
          if (!rid) continue;
          const cur = runs.get(rid);
          if (cur) {
            cur.evs.push(e);
            if ((e.created_at as string) < cur.firstAt) cur.firstAt = e.created_at as string;
          } else {
            runs.set(rid, { evs: [e], firstAt: e.created_at as string });
          }
        }
        // Sort runs by firstAt desc (latest first).
        const sortedRuns = Array.from(runs.entries()).sort((a, b) => (b[1].firstAt).localeCompare(a[1].firstAt));
        if (sortedRuns.length === 0) { outcomes[aid] = { label: "No runs", tone: "zinc" }; continue; }

        // Latest run outcome (chronological within run).
        const [latestRunId, latestRun] = sortedRuns[0];
        outcomes[aid] = computeOutcome([...latestRun.evs].sort((a, b) => (a.created_at as string).localeCompare(b.created_at as string)));

        // Streak history — only for cron-scheduled agents.
        if (cronById.get(aid)) {
          const last7 = sortedRuns.slice(0, 7).map(([rid, r]) => ({
            runId: rid,
            time: r.firstAt,
            outcome: computeOutcome([...r.evs].sort((a, b) => (a.created_at as string).localeCompare(b.created_at as string))),
          }));
          history[aid] = last7;
        }
        void latestRunId;
      }
      if (!cancelled) {
        setAgentOutcomes(outcomes);
        setAgentRunHistory(history);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);



  const [compiling, setCompiling] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tone, setTone] = useState<string | null>(null);

  const handleGenerate = async () => {
    const raw = prompt.trim();
    if (!raw || compiling) return;
    setCompiling(true);
    // Read/analyze every attached input BEFORE generation so the compiler
    // works off real understanding — not raw appended text.
    const analyzerKind = activeType === "website" ? "website" : activeType === "business" ? "agent" : "generic";
    const { enrichedPrompt: p } = await analyzeAndBuildContext(raw, tone, attachments, analyzerKind as "website" | "agent" | "generic");

    if (activeType === "website") {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? SUPABASE_ANON;
        const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/compile-website-manifest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_ANON,
          },
          body: JSON.stringify({ prompt: p, save: true }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok || !body?.website_id) {
          toast.error(body?.error || `Website compile failed (${resp.status})`);
          setCompiling(false);
          return;
        }
        // Unified dashboard for any generated thing.
        navigate(`/generated/website/${body.website_id}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Website compile failed");
        setCompiling(false);
      }
      return;
    }

    sessionStorage.setItem("nazai_pending_prompt", p);
    sessionStorage.setItem("nazai_pending_type", activeType);
    setCompiling(false);
    navigate("/generation-workspace");
  };

  return (
    <div className="min-h-screen w-full text-white relative overflow-x-hidden" style={{ backgroundColor: "#000" }}>
      {/* Purple gradient transition at top */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(139,92,246,0.35) 0%, rgba(88,28,135,0.18) 35%, rgba(0,0,0,0) 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[400px] z-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(168,85,247,0.18) 0%, rgba(88,28,135,0.08) 40%, rgba(0,0,0,0) 100%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-zinc-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-xs font-bold">
            {user?.email?.[0]?.toUpperCase() || "N"}
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-12 md:pt-20 pb-20">
        <div className="text-[11px] font-mono tracking-[0.3em] text-zinc-400 mb-6">
          PROMPT <span className="text-purple-400">→</span> GENERATE
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold leading-[1.05] tracking-tight">
          Make your{" "}
          <span className="bg-gradient-to-r from-cyan-300 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">
            ideas real.
          </span>
        </h1>

        {/* Type chips */}
        <div className="mt-10 flex flex-wrap gap-3">
          {TYPES.map((t) => {
            const Icon = t.icon;
            const active = activeType === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveType(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm transition-all ${
                  active
                    ? "bg-purple-500/20 border-purple-400/60 text-white shadow-[0_0_20px_rgba(168,85,247,0.35)]"
                    : "bg-white/[0.03] border-white/10 text-zinc-300 hover:border-white/30"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Prompt box */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-5">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
              }
            }}
            placeholder="A luxury watchmaker's site with cinematic scroll and age verification"
            rows={3}
            className="w-full bg-transparent resize-none outline-none text-base text-zinc-100 placeholder:text-zinc-600"
          />
          <div className="flex items-center gap-2 flex-wrap pt-3 mt-2 border-t border-white/5">
            <PromptExtras
              attachments={attachments}
              onChange={setAttachments}
              tone={tone}
              onToneChange={setTone}
            />
          </div>
          <div className="flex items-center justify-between pt-3 mt-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-400/40 text-purple-300 text-xs">
              {(() => {
                const t = TYPES.find((x) => x.id === activeType)!;
                const Icon = t.icon;
                return (
                  <>
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </>
                );
              })()}
            </div>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || compiling}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-purple-400/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {compiling ? <Loader2 className="h-4 w-4 text-purple-300 animate-spin" /> : <Zap className="h-4 w-4 text-purple-300" />}
              <span className="text-sm">{compiling ? "Compiling…" : "Generate"}</span>
              <span className="text-purple-300">↗</span>
            </button>
          </div>
        </div>

        {/* Recent */}
        <div className="mt-16">
          <div className="flex items-center justify-between mb-5">
            <div className="text-[11px] font-mono tracking-[0.3em] text-zinc-500">RECENT</div>
            {(recentProjects.length > 0 || recentAgents.length > 0) && (
              <button
                onClick={() => navigate("/dashboard/all-projects")}
                className="flex items-center gap-1 text-sm text-purple-300 hover:text-purple-200"
              >
                All projects <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>

          {loading || agentsLoading ? (
            <div className="text-sm text-zinc-600">Loading…</div>
          ) : recentProjects.length === 0 && recentAgents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
              <p className="text-zinc-500 text-sm">
                Your recent projects and AI agents will appear here once you start creating.
              </p>
            </div>
          ) : (
            <div className="space-y-10">
              {recentAgents.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-zinc-300">AI Agents</h3>
                    <span className="text-xs text-zinc-500">{recentAgents.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {recentAgents.map((a) => {
                      const ago = formatDistanceToNow(new Date(a.created_at), { addSuffix: true });
                      const outcome = agentOutcomes[a.id];
                      const toneClasses: Record<string, string> = {
                        green: "bg-emerald-400/10 text-emerald-300 border-emerald-400/40",
                        amber: "bg-amber-400/10 text-amber-300 border-amber-400/40",
                        red: "bg-red-400/10 text-red-300 border-red-400/40",
                        zinc: "bg-white/5 text-zinc-400 border-white/10",
                      };
                      const runs = agentRunHistory[a.id] || [];
                      const isCron = !!a.schedule_cron;
                      const isExpanded = expandedAgent === a.id;
                      const streakCounts = runs.reduce(
                        (acc, r) => {
                          if (r.outcome.label === "Done") acc.done++;
                          else if (r.outcome.label === "Failed") acc.failed++;
                          else if (r.outcome.label === "Blocked" || r.outcome.label === "Needs approval") acc.blocked++;
                          return acc;
                        },
                        { done: 0, failed: 0, blocked: 0 },
                      );
                      const dotColor = (tone: Outcome["tone"]) =>
                        tone === "green" ? "bg-emerald-400" : tone === "amber" ? "bg-amber-400" : tone === "red" ? "bg-red-400" : "bg-zinc-500";
                      return (
                        <div
                          key={`agent-${a.id}`}
                          className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.05] to-cyan-400/[0.02] hover:border-emerald-400/50 transition-all p-5"
                        >
                          <div className="flex items-start justify-between gap-2 mb-4">
                            <button
                              type="button"
                              onClick={() => navigate("/generation-workspace")}
                              className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(52,211,153,0.6)]"
                              aria-label="Open agent"
                            >
                              <Sparkles className="h-5 w-5 text-black" />
                            </button>
                            {outcome && (
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${toneClasses[outcome.tone]}`}
                                title="Derived from the latest run's events"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                {outcome.label}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => navigate("/generation-workspace")}
                            className="block w-full text-left"
                          >
                            <div className="text-[9px] uppercase tracking-[0.24em] font-mono text-emerald-300 mb-1">AI Agent</div>
                            <div className="font-semibold truncate text-white">
                              {(a.name || "Agent").slice(0, 40)}
                            </div>
                            {a.goal && (
                              <div className="text-xs text-zinc-400 line-clamp-2 mt-1">{a.goal}</div>
                            )}
                            <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
                              <Clock className="h-3 w-3" />
                              {ago}
                            </div>
                          </button>
                          {isCron && runs.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setExpandedAgent(isExpanded ? null : a.id); }}
                                className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03] transition-colors"
                                title="Last 7 scheduled runs — click to expand"
                              >
                                <div className="flex items-center gap-1">
                                  {runs.map((r) => (
                                    <span
                                      key={r.runId}
                                      className={`h-2 w-2 rounded-sm ${dotColor(r.outcome.tone)}`}
                                    />
                                  ))}
                                  {Array.from({ length: Math.max(0, 7 - runs.length) }).map((_, i) => (
                                    <span key={`empty-${i}`} className="h-2 w-2 rounded-sm bg-white/5" />
                                  ))}
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-mono">
                                  <span className="text-emerald-300">{streakCounts.done}✓</span>
                                  <span className="text-amber-300">{streakCounts.blocked}⏸</span>
                                  <span className="text-red-300">{streakCounts.failed}✕</span>
                                  <ChevronRight className={`h-3 w-3 text-zinc-500 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                </div>
                              </button>
                              {isExpanded && (
                                <ul className="mt-2 space-y-1">
                                  {runs.map((r) => (
                                    <li key={r.runId} className="flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded bg-white/[0.02]">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor(r.outcome.tone)}`} />
                                        <span className={`font-mono ${toneClasses[r.outcome.tone].split(" ").find((c) => c.startsWith("text-"))}`}>
                                          {r.outcome.label}
                                        </span>
                                      </div>
                                      <span className="text-zinc-500 shrink-0">
                                        {formatDistanceToNow(new Date(r.time), { addSuffix: true })}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {recentProjects.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-zinc-300">Websites</h3>
                    <span className="text-xs text-zinc-500">{recentProjects.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {recentProjects.map((p) => {
                      const initial = (p.directive || "?").trim()[0]?.toUpperCase() || "N";
                      const ago = formatDistanceToNow(new Date(p.updated_at || p.created_at), { addSuffix: true });
                      return (
                        <button
                          key={p.id}
                          onClick={() => navigate("/workspace")}
                          className="text-left rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-purple-400/40 transition-all p-5"
                        >
                          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center font-bold text-black mb-4">
                            {initial}
                          </div>
                          <div className="font-semibold truncate">
                            {(p.directive || "Untitled").slice(0, 40)}
                          </div>
                          <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
                            <Clock className="h-3 w-3" />
                            {ago}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
