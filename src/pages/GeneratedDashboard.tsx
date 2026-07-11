// Unified post-generation dashboard for ANY generated thing — agents, websites,
// and future generation kinds — reusing the same GeneratedAgentDashboard
// component (execution_flow, artifacts_panel, hero, etc.) instead of a bespoke
// per-type view.
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import GeneratedAgentDashboard, { type AgentUiSpec, type Widget } from "@/components/agents/GeneratedAgentDashboard";
import AgentCockpit, { type AgentManifest } from "@/components/agents/AgentCockpit";

type Params = { kind: string; id: string };

type SynthEvent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
  run_id?: string | null;
};

/** Build a GeneratedAgentDashboard Manifest + synthetic event stream from a website record. */
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
      { kind: "hero_metric", title: "Sections", staticValue: String(totalSections), subtitle: "Total blocks compiled", span: 3 },
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
      new Set(
        pages.flatMap((p: any) => (p.sections || []).map((s: any) => s?.type).filter(Boolean)),
      ),
    ).map((t: any) => ({
      name: String(t),
      description: `${t} block`,
      kind: "section",
      config: {},
    })),
    guardrails: [],
    kpis: [
      { name: "Design identity", target: theme.layout || "custom" },
      { name: "Font pairing", target: `${theme.font?.heading || "—"} / ${theme.font?.body || "—"}` },
    ],
    workflowSummary: theme.design_rationale || website.prompt || "Auto-generated website from your brief.",
    ui,
  };

  // Synthetic event stream — makes execution_flow / artifacts_panel populate.
  const t0 = new Date(website.created_at || Date.now()).getTime();
  const events: SynthEvent[] = [
    {
      id: `${website.id}-start`,
      kind: "run_started",
      payload: { note: "Compile started" },
      created_at: new Date(t0).toISOString(),
      run_id: website.id,
    },
    {
      id: `${website.id}-reasoning`,
      kind: "reasoning",
      payload: { text: theme.design_rationale || `Interpreted brief: ${website.prompt || website.name}` },
      created_at: new Date(t0 + 1000).toISOString(),
      run_id: website.id,
    },
  ];
  let step = 2;
  pages.forEach((p: any) => {
    events.push({
      id: `${p.id}-page`,
      kind: "action",
      payload: { title: `Page: ${p.title || p.slug}`, slug: p.slug, sections: (p.sections || []).length },
      created_at: new Date(t0 + 1000 * step++).toISOString(),
      run_id: website.id,
    });
    (p.sections || []).forEach((s: any, i: number) => {
      events.push({
        id: `${p.id}-s-${i}`,
        kind: "tool_call",
        payload: { tool: s?.type || "section", variant: s?.variant, page: p.slug },
        created_at: new Date(t0 + 1000 * step++).toISOString(),
        run_id: website.id,
      });
    });
  });
  events.push({
    id: `${website.id}-finished`,
    kind: "finished",
    payload: { pages: pages.length, sections: totalSections },
    created_at: new Date(t0 + 1000 * step).toISOString(),
    run_id: website.id,
  });

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

  useEffect(() => {
    if (!id || !kind) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (kind === "website") {
          const { data: site, error: sErr } = await supabase
            .from("websites")
            .select("*")
            .eq("id", id)
            .maybeSingle();
          if (sErr) throw sErr;
          if (!site) throw new Error("Website not found");
          const { data: pgs } = await supabase
            .from("website_pages")
            .select("*")
            .eq("website_id", id)
            .order("order_index", { ascending: true });
          if (cancelled) return;
          setWebsite(site);
          setPages(pgs || []);
        } else if (kind === "agent") {
          const { data: agent, error: aErr } = await supabase
            .from("agents")
            .select("*")
            .eq("id", id)
            .maybeSingle();
          if (aErr) throw aErr;
          if (!agent) throw new Error("Agent not found");
          if (cancelled) return;
          // agents.manifest column stores the compiled manifest.
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617] text-white">
        <div className="flex items-center gap-3 text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading dashboard…</span>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#020617] text-white gap-4">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => navigate("/generator-home")}
          className="px-4 py-2 rounded-lg border border-white/10 text-sm hover:bg-white/5"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-white">
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-[#020617]/70 border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate("/generator-home")}
          className="flex items-center gap-2 text-white/60 hover:text-white transition text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/40">
          {kind} · dashboard
        </div>
        {kind === "website" && id && (
          <Link
            to={`/website-preview/${id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-400/40 text-purple-300 hover:bg-purple-400/10 text-xs"
          >
            Open preview <ExternalLink className="h-3 w-3" />
          </Link>
        )}
        {kind !== "website" && <div className="w-16" />}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {kind === "website" && websiteData && (
          <GeneratedAgentDashboard
            manifest={websiteData.manifest}
            events={websiteData.events as any}
            agentId={undefined}
          />
        )}
        {kind === "agent" && agentManifest && id && (
          <AgentCockpit agentId={id} manifest={agentManifest} />
        )}
      </main>
    </div>
  );
}
