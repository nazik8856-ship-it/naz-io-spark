// Post-generation workspace. Websites get their own preview/code/chat surface
// (fully separate from the AI-Agent pipeline — no agent widgets, no dashboard
// tab, no agent-specific fields). Agents keep their cockpit workspace.
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  LayoutDashboard,
  Monitor,
  Smartphone,
  Tablet,
  RefreshCw,
  Share2,
  Rocket,
  MoreHorizontal,
  ChevronDown,
  Code2,
  Copy,
  Trash2,
  Pencil,
  Download,
  Check,
  Eye,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AgentCockpit, { type AgentManifest } from "@/components/agents/AgentCockpit";
import LiveAgentChat from "@/components/agents/LiveAgentChat";
import { analyzeAndBuildContext } from "@/components/generator/PromptExtras";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type WebsiteView = "preview" | "code";
type Device = "desktop" | "tablet" | "phone";
const DEVICE_WIDTH: Record<Device, string> = {
  desktop: "100%",
  tablet: "820px",
  phone: "390px",
};

type Params = { kind: string; id: string };

type ChatTurn = { role: "user" | "assistant"; content: string; time: string };

const previewCacheKey = (websiteId: string) => `nazai_website_preview_${websiteId}`;

function cacheWebsitePreview(websiteId: string, website: unknown, pages: unknown[]) {
  try {
    localStorage.setItem(previewCacheKey(websiteId), JSON.stringify({ website, pages, cachedAt: Date.now() }));
  } catch {
    // The database remains authoritative; cache is only an immediate iframe fallback.
  }
}

function readCachedWebsitePreview(websiteId: string) {
  try {
    const cached = JSON.parse(localStorage.getItem(previewCacheKey(websiteId)) || "null");
    if (cached?.website?.id === websiteId && Array.isArray(cached?.pages) && cached.pages.length > 0) {
      return cached as { website: any; pages: any[] };
    }
  } catch {
    // Ignore malformed or unavailable browser storage.
  }
  return null;
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
  const [webView, setWebView] = useState<WebsiteView>("preview");
  const [agentTab, setAgentTab] = useState<"preview" | "dashboard">("dashboard");
  const [device, setDevice] = useState<Device>("desktop");
  const [selectedPage, setSelectedPage] = useState<string>("");
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const pageMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (pageMenuRef.current && !pageMenuRef.current.contains(e.target as Node)) setPageMenuOpen(false);
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

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
          const { data: pgs, error: pErr } = await supabase.from("website_pages").select("*").eq("website_id", id).order("order_index", { ascending: true });
          if (pErr) throw pErr;
          if (cancelled) return;
          setWebsite(site);
          setPages(pgs || []);
          cacheWebsitePreview(id, site, pgs || []);
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
        if (!cancelled && kind === "website") {
          const cached = readCachedWebsitePreview(id);
          if (cached) {
            setWebsite(cached.website);
            setPages(cached.pages);
            setTurns([
              { role: "user", content: cached.website.prompt || cached.website.name || "Generate my website", time: "just now" },
              { role: "assistant", content: `Built "${cached.website.name || "your site"}" — the live preview is ready.`, time: "just now" },
            ]);
            setError(null);
          } else {
            setError(e instanceof Error ? e.message : String(e));
          }
        } else if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, id, user?.id]);




  const sendWebsiteEdit = async (text: string) => {
    if (!id) return;
    setTurns((t) => [...t, { role: "user", content: text, time: "just now" }]);
    setChatBusy(true);
    try {
      // Analyze every website follow-up as a design brief before execution. The
      // compiler still receives the current manifest, so this enriches intent
      // without regenerating or discarding untouched work.
      const { enrichedPrompt } = await analyzeAndBuildContext(text, null, [], "website");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await supabase.functions.invoke("compile-website-manifest", {
        body: {
          prompt: enrichedPrompt,
          previousWebsiteId: id,
          refine: true,
          save: true,
          recentTurns: [...turns, { role: "user", content: text }]
            .slice(-6)
            .map(({ role, content }) => ({ role, content })),
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (resp.error) throw new Error(resp.error.message || "Refine failed");
      const summary = (resp.data as any)?.summary || "Updated.";
      const intent = (resp.data as any)?.intent || "mixed";
      const { data: site } = await supabase.from("websites").select("*").eq("id", id).maybeSingle();
      const { data: pgs } = await supabase.from("website_pages").select("*").eq("website_id", id).order("order_index", { ascending: true });
      if (site) setWebsite(site);
      if (pgs) setPages(pgs);
      if (site && pgs) cacheWebsitePreview(id, site, pgs);
      setPreviewKey((k) => k + 1);
      setTurns((t) => [...t, { role: "assistant", content: `✓ ${summary} _(${intent} edit — preview refreshed)_`, time: "just now" }]);
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

  const liveUrl = id ? `${typeof window !== "undefined" ? window.location.origin : ""}/website-preview/${id}` : "";
  const currentPage = pages.find((p) => p.slug === selectedPage) || pages[0];
  const previewSrc = id
    ? `/website-preview/${id}${currentPage?.slug ? `?page=${encodeURIComponent(currentPage.slug)}` : ""}`
    : "";
  const refreshPreview = () => setPreviewKey((k) => k + 1);
  const copyShare = async () => {
    if (!liveUrl) return;
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      toast.success("Share link copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy link");
    }
  };
  const publishSite = () => {
    if (!id) return;
    setDomainInput((website?.custom_domain as string) || "");
    setPublishOpen(true);
  };
  const confirmPublish = async (opts: { saveDomain: boolean }) => {
    if (!id) return;
    try {
      setSavingDomain(true);
      if (opts.saveDomain) {
        const raw = domainInput.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        if (raw && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(raw)) {
          toast.error("That doesn't look like a valid domain");
          setSavingDomain(false);
          return;
        }
        const { error: upErr } = await supabase
          .from("websites")
          .update({ custom_domain: raw || null } as any)
          .eq("id", id);
        if (upErr) throw upErr;
        setWebsite((w: any) => (w ? { ...w, custom_domain: raw || null } : w));
        if (raw) toast.success(`Domain saved: ${raw}`);
      }
      setPublishOpen(false);
      window.open(`/website-preview/${id}`, "_blank");
      toast.success("Opening live site — use the publish flow in project settings to deploy.");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save domain");
    } finally {
      setSavingDomain(false);
    }
  };
  const exportSite = async () => {
    try {
      const payload = { website, pages };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(website?.name || "website").replace(/\s+/g, "-").toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed");
    }
  };
  const renameSite = async () => {
    const next = prompt("Rename website", website?.name || "");
    if (!next || next === website?.name) return;
    const { error } = await supabase.from("websites").update({ name: next }).eq("id", id!);
    if (error) return toast.error(error.message);
    setWebsite((w: any) => ({ ...w, name: next }));
    toast.success("Renamed");
  };
  const duplicateSite = async () => {
    if (!website) return;
    const { data, error } = await supabase
      .from("websites")
      .insert({
        name: `${website.name || "Website"} (copy)`,
        prompt: website.prompt,
        tagline: website.tagline,
        theme: website.theme,
        html: website.html || "",
        user_id: website.user_id,
      })
      .select()
      .maybeSingle();
    if (error || !data) return toast.error(error?.message || "Duplicate failed");
    if (pages.length > 0) {
      const { error: pagesError } = await supabase.from("website_pages").insert(
        pages.map((page, index) => ({
          website_id: data.id,
          slug: page.slug,
          title: page.title,
          seo_description: page.seo_description,
          sections: page.sections,
          order_index: index,
        })),
      );
      if (pagesError) {
        await supabase.from("websites").delete().eq("id", data.id);
        return toast.error(`Duplicate failed: ${pagesError.message}`);
      }
    }
    toast.success("Duplicated");
    navigate(`/generated/website/${data.id}`);
  };
  const deleteSite = async () => {
    if (!id || !confirm("Delete this website? This cannot be undone.")) return;
    const { error } = await supabase.from("websites").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    navigate("/generator-home");
  };

  return (
    <div className="h-screen flex flex-col bg-[#020617] text-white">
      {kind === "website" ? (
        <header
          className="shrink-0 relative border-b border-white/[0.06] px-4 py-2.5 flex items-center gap-3"
          style={{
            background:
              "linear-gradient(180deg, rgba(10,15,30,0.92) 0%, rgba(2,6,23,0.92) 100%)",
            backdropFilter: "blur(24px)",
          }}
        >
          {/* Left: back + title + page selector */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => navigate("/generator-home")}
              className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/[0.06] transition"
              title="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="h-4 w-px bg-white/10 mx-1" />
            <div className="min-w-0 flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-gradient-to-br from-cyan-400/30 to-purple-500/30 border border-white/10 flex items-center justify-center text-[10px] font-bold text-cyan-200">
                {(website?.name || "W").slice(0, 1).toUpperCase()}
              </div>
              <div className="text-sm font-semibold text-white truncate max-w-[180px]">
                {website?.name || "Untitled"}
              </div>
            </div>

            {/* Page dropdown */}
            {pages.length > 0 && (
              <div className="relative ml-1" ref={pageMenuRef}>
                <button
                  onClick={() => setPageMenuOpen((o) => !o)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-white/70 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition"
                >
                  {currentPage?.title || currentPage?.slug || "Homepage"}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                {pageMenuOpen && (
                  <div className="absolute left-0 top-full mt-1.5 min-w-[220px] rounded-lg border border-white/10 bg-[#0a0f1e] shadow-2xl shadow-black/60 py-1 z-50">
                    {pages.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPage(p.slug);
                          setPageMenuOpen(false);
                          refreshPreview();
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-white/[0.06] transition",
                          (currentPage?.slug === p.slug) ? "text-cyan-300" : "text-white/70",
                        )}
                      >
                        <span className="truncate">{p.title || p.slug}</span>
                        <span className="text-[10px] text-white/30 font-mono">/{p.slug}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Center: view switcher */}
          <div className="flex-1 flex justify-center">
            <div className="inline-flex items-center p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {([
                { key: "preview" as const, label: "Preview", icon: Eye },
                { key: "code" as const, label: "Code", icon: Code2 },
              ]).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setWebView(key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition",
                    webView === key
                      ? "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                      : "text-white/50 hover:text-white/80",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
              <div className="relative" ref={moreMenuRef}>
                <button
                  onClick={() => setMoreOpen((o) => !o)}
                  className={cn(
                    "flex items-center px-2 py-1.5 rounded-md text-xs transition",
                    moreOpen ? "bg-white/[0.09] text-white" : "text-white/50 hover:text-white/80",
                  )}
                  title="More"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                {moreOpen && (
                  <div className="absolute right-0 top-full mt-1.5 min-w-[180px] rounded-lg border border-white/10 bg-[#0a0f1e] shadow-2xl shadow-black/60 py-1 z-50">
                    {[
                      { icon: Pencil, label: "Rename", onClick: renameSite },
                      { icon: Copy, label: "Duplicate", onClick: duplicateSite },
                      { icon: Download, label: "Export", onClick: exportSite },
                      { icon: Trash2, label: "Delete", onClick: deleteSite, danger: true },
                    ].map(({ icon: Icon, label, onClick, danger }) => (
                      <button
                        key={label}
                        onClick={() => { setMoreOpen(false); onClick(); }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition",
                          danger ? "text-red-300 hover:bg-red-500/10" : "text-white/70 hover:bg-white/[0.06]",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: device + refresh + external + share + publish */}
          <div className="flex items-center gap-1.5">
            <div className="inline-flex items-center p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {([
                { key: "desktop" as const, icon: Monitor, label: "Desktop" },
                { key: "tablet" as const, icon: Tablet, label: "Tablet" },
                { key: "phone" as const, icon: Smartphone, label: "Phone" },
              ]).map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  onClick={() => setDevice(key)}
                  title={label}
                  className={cn(
                    "p-1.5 rounded-md transition",
                    device === key ? "bg-white/[0.1] text-white" : "text-white/40 hover:text-white/70",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
            <button
              onClick={refreshPreview}
              title="Refresh preview"
              className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/[0.06] transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <a
              href={previewSrc || "#"}
              target="_blank"
              rel="noreferrer"
              title="Open live preview"
              className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/[0.06] transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <div className="h-4 w-px bg-white/10 mx-1" />
            <button
              onClick={copyShare}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white/80 bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] transition"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Share2 className="h-3.5 w-3.5" />}
              Share
            </button>
            <button
              onClick={publishSite}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-[#001018] bg-gradient-to-r from-cyan-300 to-cyan-400 hover:from-cyan-200 hover:to-cyan-300 shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)] transition"
            >
              <Rocket className="h-3.5 w-3.5" />
              Publish
            </button>
          </div>
        </header>
      ) : (
        <header className="shrink-0 backdrop-blur-xl bg-[#020617]/70 border-b border-white/5 px-6 py-3 flex items-center justify-between">
          <button onClick={() => navigate("/generator-home")} className="flex items-center gap-2 text-white/60 hover:text-white transition text-sm">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/40">{kind} · workspace</div>
          <div className="w-16" />
        </header>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left: chat pane */}
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

        {/* Right: main content */}
        <section className="flex-1 flex flex-col min-w-0 bg-[#0a0f1e]">
          {kind === "website" && (
            <div className="flex-1 min-h-0 flex flex-col">
              {webView === "preview" && id && (
                // Explicit absolute positioning + fixed inset guarantees the
                // iframe fills the pane. Prior `h-full` on a flex item under
                // `items-center` collapsed the iframe to ~150px in Chrome,
                // producing the "solid color block" the user reported.
                <div className="relative flex-1 min-h-0 bg-[#050813] flex justify-center p-4">
                  <div
                    className="relative bg-white rounded-lg overflow-hidden shadow-2xl shadow-black/60 transition-[width] duration-300 ease-out w-full"
                    style={{
                      width: DEVICE_WIDTH[device],
                      maxWidth: "100%",
                      height: "100%",
                    }}
                  >
                    <iframe
                      key={previewKey}
                      src={previewSrc}
                      title="Website preview"
                      className="absolute inset-0 w-full h-full bg-white border-0 block"
                    />
                  </div>
                </div>
              )}

              {webView === "code" && (
                <div className="h-full overflow-auto p-6">
                  <div className="max-w-5xl mx-auto space-y-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-cyan-300/80">
                      Compiled manifest
                    </div>
                    <pre className="text-[11px] leading-relaxed font-mono text-cyan-100/90 bg-black/60 border border-white/[0.06] rounded-xl p-5 overflow-x-auto whitespace-pre">
{JSON.stringify({ website, pages }, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
          {kind === "agent" && (
            <>
              <div className="shrink-0 border-b border-white/5 px-4 flex items-center gap-1">
                {(["preview", "dashboard"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setAgentTab(t)}
                    className={cn(
                      "px-3 py-2.5 text-xs font-mono uppercase tracking-[0.2em] flex items-center gap-1.5 border-b-2 -mb-px",
                      agentTab === t
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
                {agentTab === "preview" && (
                  <div className="p-6 text-white/50 text-sm">Agent preview lives in the dashboard tab.</div>
                )}
                {agentTab === "dashboard" && agentManifest && id && (
                  <div className="p-6">
                    <AgentCockpit agentId={id} manifest={agentManifest} />
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      {publishOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !savingDomain && setPublishOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f1e] shadow-[0_20px_80px_-20px_rgba(34,211,238,0.3)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Rocket className="h-4 w-4 text-cyan-300" />
              <h3 className="text-white font-semibold">Publish website</h3>
            </div>
            <p className="text-xs text-white/50 mb-4">
              Add a custom domain now, or skip to keep the current setup.
            </p>
            <label className="block text-[11px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">
              Custom domain (optional)
            </label>
            <input
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="yourdomain.com"
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 focus:border-cyan-400/60 focus:outline-none text-sm text-white placeholder:text-white/30"
            />
            {website?.custom_domain && (
              <p className="mt-2 text-[11px] text-white/40">
                Saved: <span className="text-cyan-300/80 font-mono">{website.custom_domain}</span>
              </p>
            )}
            <p className="mt-3 text-[11px] text-white/40 leading-relaxed">
              Domains are stored securely on your account. After saving, point an A record for the root and{" "}
              <span className="font-mono">www</span> to <span className="font-mono text-white/70">185.158.133.1</span> at your registrar.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                disabled={savingDomain}
                onClick={() => confirmPublish({ saveDomain: false })}
                className="px-3 py-1.5 rounded-md text-xs text-white/70 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition disabled:opacity-50"
              >
                Skip
              </button>
              <button
                disabled={savingDomain}
                onClick={() => confirmPublish({ saveDomain: true })}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-[#001018] bg-gradient-to-r from-cyan-300 to-cyan-400 hover:from-cyan-200 hover:to-cyan-300 transition disabled:opacity-60"
              >
                {savingDomain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                {domainInput.trim() ? "Save & publish" : "Publish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
