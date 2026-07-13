// Unified post-generation workspace: mirrors the AI-Agent generation UI
// (left chat pane + right tabbed Preview/Dashboard) for ANY generation kind
// — websites, agents, and future ones — so every generated thing lands in the
// same chat-plus-dashboard experience.
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2, LayoutDashboard, Monitor, Package, X, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import GeneratedAgentDashboard, { type AgentUiSpec, type Widget } from "@/components/agents/GeneratedAgentDashboard";
import AgentCockpit, { type AgentManifest } from "@/components/agents/AgentCockpit";
import LiveAgentChat from "@/components/agents/LiveAgentChat";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Params = { kind: string; id: string };

type SynthEvent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
  run_id?: string | null;
};

type ChatTurn = { role: "user" | "assistant"; content: string; time: string };

function synthesizeWebsiteManifest(
  website: any,
  pages: any[],
): { manifest: Parameters<typeof GeneratedAgentDashboard>[0]["manifest"]; events: SynthEvent[] } {
  const theme = (website?.theme || {}) as any;
  const palette = theme.palette || {};
  const accent = palette.accent || "#a855f7";
  const accentSecondary = palette.accentSecondary || palette.accent2 || "#22d3ee";
  const totalSections = pages.reduce((n, p) => n + ((p.sections || []).length || 0), 0);

  const ui: AgentUiSpec = {
    theme: "obsidian",
    accent,
    accentSecondary,
    hero: {
      title: website.name || website.title || "Generated site",
      tagline: website.tagline || theme.design_rationale || "Live website — inspect pages, sections, and design identity.",
      icon: "globe",
    },
    layout: "command-deck",
    widgets: [
      { kind: "hero_metric", title: "Pages", staticValue: String(pages.length), subtitle: "Generated & live", span: 3 },
      { kind: "hero_metric", title: "Sections", staticValue: String(totalSections), subtitle: "Blocks compiled", span: 3 },
      { kind: "hero_metric", title: "Layout", staticValue: theme.layout || "custom", subtitle: "Design identity", span: 3 },
      { kind: "hero_metric", title: "Motion", staticValue: theme.motion || "subtle", subtitle: "Animation profile", span: 3 },
      { kind: "execution_flow", title: "Compile trace", limit: 12, span: 6 },
      { kind: "artifacts_panel", title: "Pages & sections", limit: 20, span: 6 },
      { kind: "workflow_summary", title: "Design rationale", span: 6 },
      { kind: "tool_grid", title: "Section blocks", span: 6 },
    ] as Widget[],
  };

  const manifest = {
    name: website.name || website.title || "Website",
    goal: website.tagline || website.prompt || "Deliver the website's promise.",
    tools: Array.from(
      new Set(pages.flatMap((p: any) => (p.sections || []).map((s: any) => s?.type).filter(Boolean))),
    ).map((t: any) => ({ name: String(t), description: `${t} block`, kind: "section", config: {} })),
    guardrails: [],
    kpis: [
      { name: "Design identity", target: theme.layout || "custom" },
      { name: "Font pairing", target: `${theme.font?.heading || "—"} / ${theme.font?.body || "—"}` },
    ],
    workflowSummary: theme.design_rationale || website.prompt || "Auto-generated website from your brief.",
    ui,
  };

  const t0 = new Date(website.created_at || Date.now()).getTime();
  const events: SynthEvent[] = [
    { id: `${website.id}-start`, kind: "run_started", payload: { note: "Compile started" }, created_at: new Date(t0).toISOString(), run_id: website.id },
    { id: `${website.id}-reasoning`, kind: "reasoning", payload: { text: theme.design_rationale || `Interpreted brief: ${website.prompt || website.name}` }, created_at: new Date(t0 + 1000).toISOString(), run_id: website.id },
  ];
  let step = 2;
  pages.forEach((p: any) => {
    events.push({ id: `${p.id}-page`, kind: "action", payload: { title: `Page: ${p.title || p.slug}`, slug: p.slug, sections: (p.sections || []).length }, created_at: new Date(t0 + 1000 * step++).toISOString(), run_id: website.id });
    (p.sections || []).forEach((s: any, i: number) => {
      events.push({ id: `${p.id}-s-${i}`, kind: "tool_call", payload: { tool: s?.type || "section", variant: s?.variant, page: p.slug }, created_at: new Date(t0 + 1000 * step++).toISOString(), run_id: website.id });
    });
  });
  events.push({ id: `${website.id}-finished`, kind: "finished", payload: { pages: pages.length, sections: totalSections }, created_at: new Date(t0 + 1000 * step).toISOString(), run_id: website.id });
  return { manifest, events };
}




export default function GeneratedDashboard() {
  const { kind, id } = useParams<Params>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState<any | null>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [agentManifest, setAgentManifest] = useState<AgentManifest | null>(null);
  const [activeTab, setActiveTab] = useState<"preview" | "dashboard">("dashboard");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [outputsOpen, setOutputsOpen] = useState(false);

  useEffect(() => {
    if (!id || !kind) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (kind === "website") {
          const { data: site, error: sErr } = await supabase.from("websites").select("*").eq("id", id).maybeSingle();
          if (sErr) throw sErr;
          if (!site) throw new Error("Website not found");
          const { data: pgs } = await supabase.from("website_pages").select("*").eq("website_id", id).order("order_index", { ascending: true });
          if (cancelled) return;
          setWebsite(site);
          setPages(pgs || []);
          setTurns([
            { role: "user", content: site.prompt || site.name || "Generate my website", time: "just now" },
            {
              role: "assistant",
              content: `Built "${site.name || "your site"}" — ${(pgs || []).length} page${(pgs || []).length === 1 ? "" : "s"}, ${((pgs || []).reduce((n: number, p: any) => n + ((p.sections || []).length || 0), 0))} sections. Switch to Preview to see it live, or Dashboard for the compile trace. Tell me what to change.`,
              time: "just now",
            },
          ]);
        } else if (kind === "agent") {
          const { data: agent, error: aErr } = await supabase.from("agents").select("*").eq("id", id).maybeSingle();
          if (aErr) throw aErr;
          if (!agent) throw new Error("Agent not found");
          if (cancelled) return;
          const m = (agent as any).manifest || {};
          setAgentManifest({
            name: agent.name || m.name || "Agent",
            goal: agent.goal || m.goal || "",
            systemPrompt: m.systemPrompt || "",
            decisionPolicy: m.decisionPolicy || "",
            tools: m.tools || [],
            triggers: m.triggers || [],
            guardrails: m.guardrails || [],
            kpis: m.kpis || [],
            ui: m.ui,
          });
        } else {
          throw new Error(`Unsupported kind: ${kind}`);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, id, user?.id]);

  const websiteData = useMemo(
    () => (website ? synthesizeWebsiteManifest(website, pages) : null),
    [website, pages],
  );

  const sendWebsiteEdit = async (text: string) => {
    if (!id) return;
    setTurns((t) => [...t, { role: "user", content: text, time: "just now" }]);
    setChatBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await supabase.functions.invoke("compile-website-manifest", {
        body: {
          prompt: text,
          previousWebsiteId: id,
          refine: true,
          save: true,
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (resp.error) throw new Error(resp.error.message || "Refine failed");
      const { data: site } = await supabase.from("websites").select("*").eq("id", id).maybeSingle();
      const { data: pgs } = await supabase.from("website_pages").select("*").eq("website_id", id).order("order_index", { ascending: true });
      if (site) setWebsite(site);
      if (pgs) setPages(pgs);
      setPreviewKey((k) => k + 1);
      setTurns((t) => [...t, { role: "assistant", content: "✓ Updated. Preview refreshed.", time: "just now" }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTurns((t) => [...t, { role: "assistant", content: `Couldn't apply that: ${msg}`, time: "just now" }]);
      toast.error(msg);
    } finally {
      setChatBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617] text-white">
        <div className="flex items-center gap-3 text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading workspace…</span>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#020617] text-white gap-4">
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={() => navigate("/generator-home")} className="px-4 py-2 rounded-lg border border-white/10 text-sm hover:bg-white/5">Back</button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#020617] text-white">
      <header className="shrink-0 backdrop-blur-xl bg-[#020617]/70 border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <button onClick={() => navigate("/generator-home")} className="flex items-center gap-2 text-white/60 hover:text-white transition text-sm">
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/40">{kind} · workspace</div>
        {kind === "website" && id ? (
          <Link to={`/website-preview/${id}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-400/40 text-purple-300 hover:bg-purple-400/10 text-xs">
            Open full <ExternalLink className="h-3 w-3" />
          </Link>
        ) : <div className="w-16" />}
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left: chat pane — same LiveAgentChat used by AI Agent workspace */}
        {kind === "website" && (
          <div className="w-full md:max-w-[420px] border-r border-white/5 bg-[#050813] flex flex-col min-h-0">
            <LiveAgentChat
              agentId={id || "website"}
              name={website?.name || "Website"}
              goal={website?.tagline || website?.prompt || undefined}
              turns={turns.map((t) => ({ role: t.role, content: t.content }))}
              suggestions={[
                "Make the hero more editorial",
                "Add a testimonials section",
                "Use a warmer palette",
                "Tighten the copy",
              ]}
              streaming={chatBusy}
              fullSpec={website?.theme?.design_rationale || website?.prompt || ""}
              onSend={sendWebsiteEdit}
            />
          </div>
        )}
        {kind === "agent" && agentManifest && (
          <div className="w-full md:max-w-[420px] border-r border-white/5 bg-[#050813] flex flex-col min-h-0">
            <LiveAgentChat
              agentId={id || "agent"}
              name={agentManifest.name}
              goal={agentManifest.goal}
              turns={[
                { role: "user", content: agentManifest.goal || "Build my agent" },
                { role: "assistant", content: `Deployed "${agentManifest.name}". Run it from the dashboard or ask for tweaks here.` },
              ]}
              suggestions={[]}
              streaming={false}
              fullSpec={agentManifest.systemPrompt || ""}
              onSend={(t) => toast.info(`Agent edits coming soon: "${t}"`)}
            />
          </div>
        )}


        {/* Right: tabbed Preview + Dashboard */}
        <section className="flex-1 flex flex-col min-w-0 bg-[#0a0f1e]">
          <div className="shrink-0 border-b border-white/5 px-4 flex items-center gap-1">
            {(["preview", "dashboard"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={cn(
                  "px-3 py-2.5 text-xs font-mono uppercase tracking-[0.2em] flex items-center gap-1.5 border-b-2 -mb-px",
                  activeTab === t
                    ? "text-white border-cyan-400"
                    : "text-white/40 hover:text-white/70 border-transparent",
                )}
              >
                {t === "preview" ? <Monitor className="h-3.5 w-3.5" /> : <LayoutDashboard className="h-3.5 w-3.5" />}
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {activeTab === "preview" && kind === "website" && id && (
              <iframe
                key={previewKey}
                src={`/website-preview/${id}`}
                title="Website preview"
                className="w-full h-full bg-white"
              />
            )}
            {activeTab === "preview" && kind === "agent" && (
              <div className="p-6 text-white/50 text-sm">Agent preview lives in the dashboard tab.</div>
            )}
            {activeTab === "dashboard" && kind === "website" && websiteData && (
              <div className="relative h-full overflow-y-auto px-6 md:px-10 py-8">
                <div className="max-w-6xl mx-auto rounded-xl border border-emerald-400/50 bg-black/55 backdrop-blur-sm overflow-hidden shadow-[0_0_60px_-15px_rgba(16,185,129,0.5)]">
                  <div className="flex items-start justify-between gap-4 p-5 border-b border-white/10 bg-gradient-to-r from-emerald-400/10 via-cyan-400/5 to-transparent">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.22em] font-mono mb-2 text-emerald-300">
                        Website Generated!
                      </div>
                      <h1 className="text-2xl md:text-3xl font-bold text-white truncate">
                        {website?.name || "Your website"}
                      </h1>
                      {(website?.tagline || website?.theme?.design_rationale) && (
                        <p className="text-sm text-cyan-200/90 mt-2 line-clamp-2">
                          🎯 {website?.tagline || website?.theme?.design_rationale}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded inline-flex items-center gap-1 bg-emerald-400/15 text-emerald-300 border border-emerald-400/40">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      LIVE SITE
                    </span>
                  </div>
                  <div className="p-5 md:p-7">
                    <GeneratedAgentDashboard
                      manifest={websiteData.manifest}
                      events={websiteData.events as any}
                      agentId={undefined}
                    />
                  </div>
                </div>
              </div>
            )}
            {activeTab === "dashboard" && kind === "agent" && agentManifest && id && (
              <div className="p-6">
                <AgentCockpit agentId={id} manifest={agentManifest} />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
