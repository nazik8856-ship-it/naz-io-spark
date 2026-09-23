import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Globe, Building2, Zap, Clock, ChevronRight, Sparkles, Loader2, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import nazaiLogo from "@/assets/nazai-logo.png";
import CreditBalance from "@/components/dashboard/CreditBalance";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import PromptExtras, { analyzeAndBuildContext, type Attachment } from "@/components/generator/PromptExtras";
import { RecentOutcomes } from "@/components/agents/RunOutcomes";
import { computeRunOutcome, type Outcome } from "@/lib/agent-outcome";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


// Small "..." menu used on each recent project card — Edit navigates to the
// same generated dashboard the card itself opens; Delete removes the row
// (RLS-scoped to the owner) and lets the caller drop it from local state.
function CardMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="More options"
        title="More"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[140px] rounded-lg border border-white/10 bg-[#0a0a0f] shadow-2xl shadow-black/60 py-1 z-50">
          <button
            type="button"
            onClick={() => { setOpen(false); onEdit(); }}
            className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-white/5 transition-colors"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onDelete(); }}
            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// Only types with a real compile backend (compile-website-manifest,
// compile-agent-manifest) are offered here. Store/Landing/App/Document
// used to appear as chips too, but had no backend at all -- selecting one
// and hitting Generate silently dropped the user into a generic chat that
// never produced anything saved. Re-add a type here only once it has a
// real compile-*-manifest function behind it.
const TYPES = [
  { id: "website", label: "Website", icon: Globe },
  { id: "business", label: "AI Agent", icon: Building2 },
];

export default function GeneratorHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [activeType, setActiveType] = useState("website");

  const WEBSITES_PAGE_SIZE = 9;
  const AGENTS_PAGE_SIZE = 6;

  type RecentWebsite = { id: string; name: string | null; tagline: string | null; created_at: string };
  const [recentWebsites, setRecentWebsites] = useState<RecentWebsite[]>([]);
  const [websitesLoading, setWebsitesLoading] = useState(false);
  const [websitesLimit, setWebsitesLimit] = useState(WEBSITES_PAGE_SIZE);
  const [websitesHasMore, setWebsitesHasMore] = useState(false);

  // Recent AI Agents — surfaced here (previously shown inside the generation
  // workspace's "Your Agents" tab). Everything the user has generated lands in
  // this Recent section now.
  type RecentAgent = { id: string; name: string; goal: string | null; created_at: string; schedule_cron: string | null };
  const [recentAgents, setRecentAgents] = useState<RecentAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsLimit, setAgentsLimit] = useState(AGENTS_PAGE_SIZE);
  const [agentsHasMore, setAgentsHasMore] = useState(false);

  type RunOutcome = { runId: string; outcome: Outcome; time: string };
  const [agentOutcomes, setAgentOutcomes] = useState<Record<string, Outcome>>({});
  // Last 7 scheduled runs per agent (cron-scheduled agents only).
  const [agentRunHistory, setAgentRunHistory] = useState<Record<string, RunOutcome[]>>({});
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setRecentWebsites([]);
      setWebsitesLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setWebsitesLoading(true);
      const { data, error } = await supabase
        .from("websites")
        .select("id, name, tagline, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(websitesLimit + 1);
      if (cancelled) return;
      if (error) {
        console.error("WEBSITES_FETCH_ERROR:", error);
        toast.error("Failed to load saved websites");
      }
      const fetched = (data as RecentWebsite[]) || [];
      setWebsitesHasMore(fetched.length > websitesLimit);
      setRecentWebsites(fetched.slice(0, websitesLimit));
      setWebsitesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id, websitesLimit]);

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
        .limit(agentsLimit + 1);
      if (cancelled) return;
      const fetched = (data as RecentAgent[]) || [];
      setAgentsHasMore(fetched.length > agentsLimit);
      const agents = fetched.slice(0, agentsLimit);
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
      // Logic lives in @/lib/agent-outcome (with real Vitest coverage) and
      // its matching Deno twin in supabase/functions/_shared/agent-outcome.ts.
      const computeOutcome = (runEvs: typeof evs): Outcome =>
        computeRunOutcome(runEvs.map((e) => ({ kind: String(e.kind || ""), payload: (e.payload as Record<string, unknown>) || {} })));

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
  }, [user?.id, agentsLimit]);



  // window.confirm() is silently suppressed (returns false with no prompt
  // ever shown) inside many sandboxed/embedded preview contexts -- which made
  // Delete look completely dead with no error and no feedback. A real
  // in-app dialog (below) can't be blocked that way.
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "agent" | "website"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // The direct client-side supabase.from(table).delete() call (gated by
      // RLS) went through three rounds of fixes in this same session --
      // replacing window.confirm(), hardening error handling, then
      // refreshing a possibly-stale session before the call -- and a live,
      // reproducible case still had it silently affect zero rows despite a
      // controlled simulation proving the RLS policy itself allows it for
      // that exact user and row. Moved to a dedicated edge function
      // (delete-project) instead: it verifies the caller's JWT directly
      // (auth.getClaims on the raw token, not the browser's in-memory
      // session state) and performs the actual delete with the service-role
      // client, scoped by an explicit user_id check in the query itself.
      // RLS and the browser's session-refresh timing are no longer part of
      // this request's path at all.
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Your session expired. Please refresh the page and sign in again.");
        return;
      }
      const resp = await supabase.functions.invoke("delete-project", {
        body: { kind: deleteTarget.kind, id: deleteTarget.id },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.error) {
        let detail = resp.error.message || `Failed to delete ${deleteTarget.kind}`;
        try {
          const ctx: any = (resp.error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) detail = body.error;
          } else if (ctx && typeof ctx.text === "function") {
            const txt = await ctx.text();
            try { const parsed = JSON.parse(txt); if (parsed?.error) detail = parsed.error; } catch { if (txt) detail = txt; }
          }
        } catch { /* keep base message */ }
        toast.error(detail);
        return;
      }
      if (deleteTarget.kind === "agent") {
        setRecentAgents((prev) => prev.filter((a) => a.id !== deleteTarget.id));
        toast.success("Agent deleted");
      } else {
        setRecentWebsites((prev) => prev.filter((w) => w.id !== deleteTarget.id));
        toast.success("Website deleted");
      }
    } catch (e) {
      // A network hiccup or an unexpected thrown error here (rather than a
      // clean {error} response) used to leave the dialog stuck on
      // "Deleting..." forever with no toast and no way out -- the delete
      // action would look completely dead. Always surface something and
      // always let the user retry or back out.
      toast.error(e instanceof Error ? e.message : "Something went wrong deleting that. Please try again.");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleDeleteWebsite = (id: string, name: string | null) => {
    setDeleteTarget({ kind: "website", id, name: name || "this website" });
  };

  const handleDeleteAgent = (id: string, name: string) => {
    setDeleteTarget({ kind: "agent", id, name });
  };

  const [compiling, setCompiling] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tone, setTone] = useState<string | null>(null);

  // Neither compile-website-manifest nor compile-agent-manifest streams
  // progress -- it's one blocking HTTP call -- so there's no real step count
  // to report. This cycles through honest, generic stage labels on a timer
  // so a 10-20s wait reads as forward motion instead of a static spinner
  // that looks identical whether it's 2 seconds in or stuck.
  const [compileStage, setCompileStage] = useState<string | null>(null);
  useEffect(() => {
    if (!compiling) {
      setCompileStage(null);
      return;
    }
    const stages = ["Understanding your prompt…", "Designing the structure…", "Generating content…", "Almost there…"];
    let i = 0;
    setCompileStage(stages[0]);
    const interval = setInterval(() => {
      i = Math.min(i + 1, stages.length - 1);
      setCompileStage(stages[i]);
    }, 4000);
    return () => clearInterval(interval);
  }, [compiling]);

  // Compiling a full website/agent from scratch can legitimately take
  // 10-20s; anything past this almost certainly means the AI call or the
  // edge function hung, not that it's still working. Without this, a hang
  // left Generate disabled with an infinite spinner and no way out.
  const COMPILE_TIMEOUT_MS = 60_000;

  const fetchWithTimeout = (url: string, init: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMPILE_TIMEOUT_MS);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  const handleGenerate = async () => {
    const raw = prompt.trim();
    if (!raw || compiling) return;
    setCompiling(true);

    // Read/analyze every attached input BEFORE generation so the compiler
    // works off real understanding — not raw appended text. This can throw
    // (e.g. a network error reading an attachment), and previously did so
    // outside any try/catch, leaving `compiling` stuck true forever with no
    // error shown -- the button just looked permanently broken.
    let p: string;
    try {
      const analyzerKind = activeType === "website" ? "website" : "agent";
      const result = await analyzeAndBuildContext(raw, tone, attachments, analyzerKind);
      p = result.enrichedPrompt;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't process your prompt/attachments");
      setCompiling(false);
      return;
    }

    if (activeType === "website") {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? SUPABASE_ANON;
        const resp = await fetchWithTimeout(`${SUPABASE_FUNCTIONS_URL}/compile-website-manifest`, {
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
        // Was previously silent: an AI failure during generation drops into
        // a generic 3-flavor fallback template with no signal at all -- the
        // response looks like a normal success. Tell the user plainly so
        // they know to regenerate rather than assume this is their real site.
        if (body?.used_fallback) {
          toast.warning("Something went wrong generating a custom design — this is a starter template. Try regenerating for a design built for your business.");
        }
        // Seed the standalone preview before navigation. The database remains
        // authoritative, but this removes the empty-frame window while the new
        // workspace performs its first owner-protected read.
        if (body?.manifest && Array.isArray(body.manifest.pages)) {
          try {
            localStorage.setItem(
              `nazai_website_preview_${body.website_id}`,
              JSON.stringify({
                website: {
                  id: body.website_id,
                  name: body.manifest.name,
                  tagline: body.manifest.tagline,
                  theme: body.manifest.theme,
                  prompt: p,
                },
                pages: body.manifest.pages.map((page: Record<string, unknown>, index: number) => ({
                  ...page,
                  id: `compiled-${body.website_id}-${index}`,
                  order_index: index,
                })),
                cachedAt: Date.now(),
              }),
            );
          } catch {
            // Storage can be unavailable in privacy modes; the cloud read below
            // still opens the same generated website.
          }
        }
        // Unified dashboard for any generated thing.
        navigate(`/generated/website/${body.website_id}`);
      } catch (e) {
        const timedOut = e instanceof DOMException && e.name === "AbortError";
        toast.error(timedOut ? "Taking too long to respond — please try again." : e instanceof Error ? e.message : "Website compile failed");
        setCompiling(false);
      }
      return;
    }

    if (activeType === "business") {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? SUPABASE_ANON;
        const resp = await fetchWithTimeout(`${SUPABASE_FUNCTIONS_URL}/compile-agent-manifest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_ANON,
          },
          body: JSON.stringify({ plan: p, save: true }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok || !body?.agentId) {
          toast.error(body?.error || `Agent compile failed (${resp.status})`);
          setCompiling(false);
          return;
        }
        navigate(`/generated/agent/${body.agentId}`);
      } catch (e) {
        const timedOut = e instanceof DOMException && e.name === "AbortError";
        toast.error(timedOut ? "Taking too long to respond — please try again." : e instanceof Error ? e.message : "Agent compile failed");
        setCompiling(false);
      }
      return;
    }

    // Unreachable in practice -- activeType only ever comes from TYPES above,
    // which is limited to website/business. Kept as an honest fallback rather
    // than a silent no-op if that ever changes.
    toast.error("This type isn't available yet");
    setCompiling(false);
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/insights")}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono uppercase tracking-wider border border-[#00A3FF]/30 bg-[#00A3FF]/5 text-[#7cc8ff] hover:bg-[#00A3FF]/15 transition-colors"
            title="What NazAI has learned about your business"
          >
            <Sparkles className="h-3.5 w-3.5" /> Insights
          </button>
          <CreditBalance compact />
          <div className="h-8 w-8 rounded-full bg-black flex items-center justify-center overflow-hidden">
            <img src={nazaiLogo} alt="NazAI" className="h-full w-full object-cover" />
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
              {compiling ? <Loader2 className="h-4 w-4 text-purple-300 animate-spin shrink-0" /> : <Zap className="h-4 w-4 text-purple-300" />}
              <span className="text-sm whitespace-nowrap">{compiling ? compileStage || "Compiling…" : "Generate"}</span>
              {!compiling && <span className="text-purple-300">↗</span>}
            </button>
          </div>
        </div>

        {/* Recent */}
        <div className="mt-16">
          <div className="flex items-center justify-between mb-5">
            <div className="text-[11px] font-mono tracking-[0.3em] text-zinc-500">RECENT</div>
            {(recentWebsites.length > 0 || recentAgents.length > 0) && (
              <span className="text-sm text-zinc-500">Saved in NazAI Cloud</span>
            )}
          </div>

          {websitesLoading || agentsLoading ? (
            <div className="text-sm text-zinc-600">Loading…</div>
          ) : recentWebsites.length === 0 && recentAgents.length === 0 ? (
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
                              onClick={() => navigate(`/generated/agent/${a.id}`)}
                              className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(52,211,153,0.6)]"
                              aria-label="Open agent"
                            >
                              <Sparkles className="h-5 w-5 text-black" />
                            </button>
                            <div className="flex items-center gap-1.5">
                              {outcome && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${toneClasses[outcome.tone]}`}
                                  title="Derived from the latest run's events"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                  {outcome.label}
                                </span>
                              )}
                              <CardMenu
                                onEdit={() => navigate(`/generated/agent/${a.id}`)}
                                onDelete={() => handleDeleteAgent(a.id, a.name || "Agent")}
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => navigate(`/generated/agent/${a.id}`)}
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
                          <RecentOutcomes agentId={a.id} limit={3} className="mt-3 pt-3 border-t border-white/5" />
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
                  {agentsHasMore && (
                    <button
                      type="button"
                      onClick={() => setAgentsLimit((l) => l + AGENTS_PAGE_SIZE)}
                      disabled={agentsLoading}
                      className="mt-4 w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider border border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-50"
                    >
                      {agentsLoading ? "Loading…" : "Load more agents"}
                    </button>
                  )}
                </section>
              )}

              {recentWebsites.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-zinc-300">Websites</h3>
                    <span className="text-xs text-zinc-500">{recentWebsites.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {recentWebsites.map((site) => {
                      const initial = (site.name || "?").trim()[0]?.toUpperCase() || "N";
                      const ago = formatDistanceToNow(new Date(site.created_at), { addSuffix: true });
                      return (
                        <div
                          key={site.id}
                          className="rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-purple-400/40 transition-all p-5"
                        >
                          <div className="flex items-start justify-between gap-2 mb-4">
                            <button
                              type="button"
                              onClick={() => navigate(`/generated/website/${site.id}`)}
                              className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center font-bold text-black"
                              aria-label="Open website"
                            >
                              {initial}
                            </button>
                            <CardMenu
                              onEdit={() => navigate(`/generated/website/${site.id}`)}
                              onDelete={() => handleDeleteWebsite(site.id, site.name)}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => navigate(`/generated/website/${site.id}`)}
                            className="block w-full text-left"
                          >
                            <div className="font-semibold truncate">
                              {(site.name || "Untitled website").slice(0, 40)}
                            </div>
                            {site.tagline && <div className="text-xs text-zinc-400 line-clamp-2 mt-1">{site.tagline}</div>}
                            <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
                              <Clock className="h-3 w-3" />
                              {ago}
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {websitesHasMore && (
                    <button
                      type="button"
                      onClick={() => setWebsitesLimit((l) => l + WEBSITES_PAGE_SIZE)}
                      disabled={websitesLoading}
                      className="mt-4 w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider border border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-50"
                    >
                      {websitesLoading ? "Loading…" : "Load more websites"}
                    </button>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </main>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-[#0a0a0f] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="bg-transparent border-white/10 text-zinc-200 hover:bg-white/5 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              className="bg-red-500/90 text-white hover:bg-red-500"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
