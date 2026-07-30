import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, SlidersHorizontal, X, Upload, Link2, Box, FileSpreadsheet, Database, Check } from "lucide-react";
import { IntegrationLogo } from "@/components/IntegrationLogos";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import IntegrationConnectModal from "@/components/agents/IntegrationConnectModal";
import { useIntegrationOAuthMessages } from "@/hooks/useIntegrationOAuthMessages";

export type Attachment = {
  id: string;
  label: string;
  contextText: string; // what gets appended to the prompt (fallback)
  url?: string;        // for URL attachments — fetched & analyzed server-side
  assetUrl?: string;   // exact uploaded/reference asset URL for the generated output
  mimeType?: string;
  kind?: string;       // "file" | "data" | "url" | "project" | "integration" | "image"
};

interface Props {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  tone: string | null;
  onToneChange: (t: string | null) => void;
}

const TONES = ["Playful", "Professional", "Luxury", "Minimal", "Bold"];
const INTEGRATIONS = [
  { id: "gdrive", label: "Google Drive", providerKey: "Google Drive" },
  { id: "gcal", label: "Google Calendar", providerKey: "Google Calendar" },
  { id: "ganalytics", label: "Google Analytics", providerKey: "Google Analytics" },
  
  { id: "shopify", label: "Shopify", providerKey: "Shopify" },
  { id: "slack", label: "Slack", providerKey: "Slack" },
  { id: "notion", label: "Notion", providerKey: "Notion" },
  { id: "canva", label: "Canva", providerKey: "Canva" },
  { id: "figma", label: "Figma", providerKey: "Figma" },
];

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export default function PromptExtras({ attachments, onChange, tone, onToneChange }: Props) {
  const { user } = useAuth();
  const [plusOpen, setPlusOpen] = useState(false);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; label: string; text: string }>>([]);
  const [connected, setConnected] = useState<Array<{ provider: string; hasSnapshot: boolean; snapshotText?: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const tunerBtnRef = useRef<HTMLButtonElement>(null);
  const plusPanelRef = useRef<HTMLDivElement>(null);
  const tunerPanelRef = useRef<HTMLDivElement>(null);
  const [plusPos, setPlusPos] = useState<{ left: number; bottom: number } | null>(null);
  const [tunerPos, setTunerPos] = useState<{ left: number; bottom: number } | null>(null);
  const [connectTarget, setConnectTarget] = useState<{ name: string; category: string } | null>(null);

  const computePos = (btn: HTMLButtonElement | null) => {
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { left: r.left, bottom: window.innerHeight - r.top + 8 };
  };

  useLayoutEffect(() => {
    if (plusOpen) setPlusPos(computePos(plusBtnRef.current));
  }, [plusOpen]);
  useLayoutEffect(() => {
    if (tunerOpen) setTunerPos(computePos(tunerBtnRef.current));
  }, [tunerOpen]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        plusOpen &&
        !plusBtnRef.current?.contains(t) &&
        !plusPanelRef.current?.contains(t)
      ) setPlusOpen(false);
      if (
        tunerOpen &&
        !tunerBtnRef.current?.contains(t) &&
        !tunerPanelRef.current?.contains(t)
      ) setTunerOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [plusOpen, tunerOpen]);

  // Load user's existing agents + websites when + menu opens (for attach-as-context)
  useEffect(() => {
    if (!plusOpen || !user?.id || projects.length) return;
    (async () => {
      const [agents, sites] = await Promise.all([
        supabase.from("agents").select("id, name, goal, role").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
        supabase.from("websites").select("id, name, tagline").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      ]);
      const items: typeof projects = [];
      (agents.data || []).forEach((a: any) => items.push({
        id: `agent-${a.id}`,
        label: `Agent · ${a.name}`,
        text: `Reference agent "${a.name}"${a.role ? ` (role: ${a.role})` : ""}${a.goal ? `. Goal: ${a.goal}` : ""}.`,
      }));
      (sites.data || []).forEach((s: any) => items.push({
        id: `site-${s.id}`,
        label: `Site · ${s.name}`,
        text: `Reference website "${s.name}"${s.tagline ? ` — ${s.tagline}` : ""}.`,
      }));
      setProjects(items);
    })();
  }, [plusOpen, user?.id, projects.length]);

  const loadConnected = useCallback(async () => {
    if (!user?.id) { setConnected([]); return; }
    const { data: ints } = await supabase
      .from("agent_integrations")
      .select("provider, metadata")
      .eq("user_id", user.id)
      .eq("status", "connected");
    const providers = new Set<string>();
    (ints || []).forEach((i: any) => {
      const p = String(i.provider || "").toLowerCase();
      if (p) providers.add(p);
      // The shared "Gmail" row records each granted Google surface in
      // metadata.services (e.g. ["drive","calendar","analytics"]). Expand
      // those into their catalogue names so per-service Connect buttons can
      // show a live green "Connected" state across every project.
      if (p === "gmail") {
        const services = Array.isArray(i.metadata?.services) ? (i.metadata.services as string[]) : [];
        services.forEach((s) => {
          const key = String(s).toLowerCase();
          if (key === "drive") providers.add("google drive");
          else if (key === "calendar") providers.add("google calendar");
          else if (key === "analytics") providers.add("google analytics");
        });
      }
    });
    const list = Array.from(providers);
    if (!list.length) { setConnected([]); return; }
    const { data: snaps } = await supabase
      .from("integration_snapshots")
      .select("provider, kind, data, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    const byProv = new Map<string, string>();
    (snaps || []).forEach((s: any) => {
      const p = String(s.provider).toLowerCase();
      if (!byProv.has(p)) byProv.set(p, JSON.stringify(s.data ?? {}));
    });
    setConnected(list.map((p) => ({ provider: p, hasSnapshot: byProv.has(p), snapshotText: byProv.get(p) })));
  }, [user?.id]);

  useEffect(() => {
    if (!tunerOpen || !user?.id) return;
    loadConnected();
  }, [tunerOpen, user?.id, loadConnected]);

  // Shared listener — every integration popup (Google bundle, Figma, Canva,
  // plus any future provider) routes through the same handler so the "Connected"
  // pill flips instantly instead of waiting for a refetch.
  useIntegrationOAuthMessages(useCallback((info) => {
    if (!user?.id) return;
    const optimisticKey =
      info.provider === "Figma" ? "figma"
      : info.provider === "Canva" ? "canva"
      : info.provider === "Notion" ? "notion"
      : info.provider === "Slack" ? "slack"
      : info.provider === "Shopify" ? "shopify"
      : (() => {
          const svc = (info.service || "").toLowerCase();
          if (svc === "drive") return "google drive";
          if (svc === "calendar") return "google calendar";
          if (svc === "analytics") return "google analytics";
          return "gmail";
        })();
    setConnected((prev) =>
      prev.some((c) => c.provider === optimisticKey)
        ? prev
        : [...prev, { provider: optimisticKey, hasSnapshot: false }],
    );
  }, [user?.id]));

  const add = (a: Attachment) => onChange([...attachments, a]);
  const remove = (id: string) => onChange(attachments.filter((a) => a.id !== id));

  const handleFiles = async (files: FileList | null, isCsv: boolean) => {
    if (!files) return;
    const next: Attachment[] = [];
    for (const f of Array.from(files)) {
      const isText = /\.(csv|txt|md|json|tsv|log|xml|yaml|yml)$/i.test(f.name) || f.type.startsWith("text/");
      // Read text/data files inline (up to 2MB) so the compiler sees actual rows,
      // not just a link. Anything larger still uploads and gets fetched server-side.
      if (isText && f.size < 2_000_000) {
        try {
          const txt = await readFileAsText(f);
          const snippet = txt.length > 20000 ? txt.slice(0, 20000) + "\n…(truncated)" : txt;
          const isJson = /\.json$/i.test(f.name) || f.type.includes("json");
          const isCsvLike = /\.(csv|tsv)$/i.test(f.name) || isCsv;
          const label = isCsvLike ? "CSV" : isJson ? "JSON" : isCsv ? "Data" : "File";
          next.push({
            id: crypto.randomUUID(),
            label: `${label} · ${f.name}`,
            kind: isCsvLike || isJson || isCsv ? "data" : "file",
            mimeType: f.type || (isJson ? "application/json" : isCsvLike ? "text/csv" : "text/plain"),
            contextText: `${isCsvLike ? "Imported CSV/TSV data" : isJson ? "Imported JSON data" : "Attached file"} "${f.name}" (${f.size} bytes). Every row/entry below is authoritative source data — turn it into real visible content in the site (pricing tiers, service cards, gallery items, stats, FAQs, testimonials, menu items, etc. — pick the section shape that fits the columns).\n\n${snippet}`,
          });
        } catch {
          toast.error(`Couldn't read ${f.name}`);
        }
      } else {

        if (!user?.id) {
          toast.error(`Sign in to attach ${f.name}`);
          continue;
        }
        try {
          const safeName = f.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
          const path = `${user.id}/prompt-inputs/${crypto.randomUUID()}-${safeName}`;
          const { error } = await supabase.storage.from("mission-assets").upload(path, f, {
            contentType: f.type || undefined,
            upsert: false,
          });
          if (error) throw error;
          const { data } = supabase.storage.from("mission-assets").getPublicUrl(path);
          const assetUrl = data.publicUrl;
          next.push({
            id: crypto.randomUUID(),
            label: `${f.type.startsWith("image/") ? "Image" : "File"} · ${f.name}`,
            kind: f.type.startsWith("image/") ? "image" : "file",
            mimeType: f.type || "application/octet-stream",
            url: assetUrl,
            assetUrl,
            contextText: `${f.type.startsWith("image/") ? "Reference image" : "Uploaded file"} "${f.name}" is available at ${assetUrl}. Analyze its actual contents and use this exact asset when the request asks to place it in the website.`,
          });
        } catch (error) {
          toast.error(`Couldn't upload ${f.name}: ${error instanceof Error ? error.message : "upload failed"}`);
        }
      }
    }
    if (next.length) onChange([...attachments, ...next]);
  };

  const attachUrl = () => {
    const u = urlInput.trim();
    if (!u) return;
    const isImage = /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(u);
    add({
      id: crypto.randomUUID(),
      label: `URL · ${u.slice(0, 40)}`,
      contextText: isImage
        ? `Reference image URL: ${u}. Analyze the image and use this exact asset in the website when requested.`
        : `Reference URL: ${u}`,
      url: u,
      assetUrl: isImage ? u : undefined,
      mimeType: isImage ? "image/*" : undefined,
      kind: isImage ? "image" : "url",
    });
    setUrlInput("");
    setPlusOpen(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* + button */}
      <button
        ref={plusBtnRef}
        type="button"
        onClick={() => { setPlusOpen((v) => !v); setTunerOpen(false); }}
        className="h-8 w-8 rounded-full bg-white/5 border border-white/10 hover:border-purple-400/50 flex items-center justify-center text-zinc-300"
        title="Attach"
      >
        <Plus className="h-4 w-4" />
      </button>
      {plusOpen && plusPos && createPortal(
        <div
          ref={plusPanelRef}
          style={{ position: "fixed", left: plusPos.left, bottom: plusPos.bottom, zIndex: 10000 }}
          className="w-72 rounded-xl border border-white/10 bg-zinc-950 p-3 shadow-2xl"
        >
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">Attach</div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-zinc-200 hover:bg-white/5"
          >
            <Upload className="h-4 w-4 text-purple-300" /> Upload file or image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files, false); setPlusOpen(false); e.target.value = ""; }}
          />
          <div className="flex items-center gap-1 px-2 py-2">
            <Link2 className="h-4 w-4 text-purple-300 shrink-0" />
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && attachUrl()}
              placeholder="Paste URL…"
              className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            <button onClick={attachUrl} className="text-xs text-purple-300 hover:text-purple-200">Add</button>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mt-3 mb-1 px-2">Your projects</div>
          <div className="max-h-40 overflow-y-auto">
            {projects.length === 0 && (
              <div className="text-xs text-zinc-600 px-2 py-1.5">No agents or sites yet.</div>
            )}
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => { add({ id: p.id, label: p.label, contextText: p.text }); setPlusOpen(false); }}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-white/5"
              >
                <Box className="h-3.5 w-3.5 text-purple-300" /> {p.label}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* sliders button */}
      <button
        ref={tunerBtnRef}
        type="button"
        onClick={() => { setTunerOpen((v) => !v); setPlusOpen(false); }}
        className="h-8 w-8 rounded-full bg-white/5 border border-white/10 hover:border-purple-400/50 flex items-center justify-center text-zinc-300"
        title="Tune"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      {tunerOpen && tunerPos && createPortal(
        <div
          ref={tunerPanelRef}
          style={{ position: "fixed", left: tunerPos.left, bottom: tunerPos.bottom, zIndex: 10000 }}
          className="w-80 rounded-xl border border-white/10 bg-zinc-950 p-3 shadow-2xl"
        >
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">Tone</div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {TONES.map((t) => (
              <button
                key={t}
                onClick={() => onToneChange(tone === t ? null : t)}
                className={`px-2.5 py-1 rounded-full text-xs border transition ${
                  tone === t
                    ? "bg-purple-500/25 border-purple-400/60 text-white"
                    : "bg-white/[0.03] border-white/10 text-zinc-300 hover:border-white/30"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">Pull data from integration</div>
          <div className="space-y-1 mb-3">
            {INTEGRATIONS.map((i) => {
              const pk = i.providerKey.toLowerCase();
              const c = connected.find((x) => x.provider === pk || x.provider === i.id || x.provider.includes(i.id.split("_")[1] || i.id));
              const already = attachments.some((a) => a.id === `int-${i.id}`);
              const attach = () => {
                if (!c) return;
                add({
                  id: `int-${i.id}`,
                  label: `Data · ${i.label}`,
                  kind: "integration",
                  contextText: c.hasSnapshot && c.snapshotText
                    ? `Live data from ${i.label} (connected):\n${c.snapshotText.slice(0, 3000)}`
                    : `User has ${i.label} connected via OAuth. Assume relevant data is available and shape output accordingly.`,
                });
                setTunerOpen(false);
              };
              return (
                <div
                  key={i.id}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs hover:bg-white/5"
                >
                  <button
                    type="button"
                    disabled={!c || already}
                    onClick={attach}
                    className="flex items-center gap-2 text-zinc-300 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Database className="h-3.5 w-3.5 text-purple-300" /> {i.label}
                  </button>
                  {already ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <Check className="h-3 w-3" /> attached
                    </span>
                  ) : c ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <Check className="h-3 w-3" /> connected
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConnectTarget({ name: i.providerKey, category: /Google|Gmail/i.test(i.providerKey) ? "Google" : i.providerKey });
                      }}
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/50 text-purple-200 hover:bg-purple-500/30 hover:text-white transition"
                    >
                      Connect
                    </button>
                  )}
                </div>
              );
            })}
          </div>


          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">Import from CSV / export</div>
          <button
            onClick={() => csvInputRef.current?.click()}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-zinc-200 border border-dashed border-white/10 hover:border-purple-400/40"
          >
            <FileSpreadsheet className="h-4 w-4 text-purple-300" /> Upload CSV/JSON (Wix, Shopify export, etc.)
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.tsv,.json,.txt,.xml,.yaml,.yml"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files, true); setTunerOpen(false); e.target.value = ""; }}
          />
        </div>,
        document.body
      )}

      {/* chips */}
      {tone && (
        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-400/40 text-xs text-purple-200">
          Tone: {tone}
          <button onClick={() => onToneChange(null)} className="hover:text-white"><X className="h-3 w-3" /></button>
        </span>
      )}
      {attachments.map((a) => (
        <span key={a.id} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 text-xs text-zinc-300 max-w-[220px]">
          <span className="truncate">{a.label}</span>
          <button onClick={() => remove(a.id)} className="hover:text-white shrink-0"><X className="h-3 w-3" /></button>
        </span>
      ))}

      {connectTarget && (
        <IntegrationConnectModal
          integration={{
            name: connectTarget.name,
            category: connectTarget.category,
            method: "Sign in",
            examples: [],
            steps: [`Sign in with ${connectTarget.name}`],
          }}
          agentId={null}
          accent="#a78bfa"
          onClose={() => setConnectTarget(null)}
          onChange={() => { loadConnected(); }}
        />
      )}
    </div>
  );
}

export function buildContextPrompt(basePrompt: string, tone: string | null, attachments: Attachment[]): string {
  const extras: string[] = [];
  if (tone) extras.push(`Desired tone/style: ${tone}.`);
  attachments.forEach((a) => extras.push(a.contextText));
  if (!extras.length) return basePrompt;
  return `${basePrompt}\n\n--- Additional context ---\n${extras.join("\n\n")}`;
}

/**
 * Runs the attached inputs (files, URLs, imported data, integration snapshots)
 * through the `analyze-inputs` edge function so the AI actually READS them and
 * returns a compact structured analysis + an enriched prompt. Falls back to the
 * sync `buildContextPrompt` if the analyzer is unavailable.
 *
 * Every generation type (websites, agents, future kinds) should call this before
 * dispatching to its compiler so the compiler works off real understanding.
 */
export async function analyzeAndBuildContext(
  basePrompt: string,
  tone: string | null,
  attachments: Attachment[],
  kind: "website" | "agent" | "generic" = "generic",
): Promise<{ enrichedPrompt: string; analysis: Record<string, unknown> | null }> {
  // Attached references need a dedicated reading pass. Bare prompts are
  // analyzed by the website/agent compiler itself to avoid duplicate AI calls.
  if (attachments.length === 0) {
    return { enrichedPrompt: buildContextPrompt(basePrompt, tone, attachments), analysis: null };
  }
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? SUPABASE_ANON;
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/analyze-inputs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify({
        prompt: basePrompt,
        tone,
        kind,
        attachments: attachments.map((a) => ({
          id: a.id,
          label: a.label,
          contextText: a.contextText,
          url: a.url,
          assetUrl: a.assetUrl,
          mimeType: a.mimeType,
          kind: a.kind,
        })),
      }),
    });
    if (!resp.ok) throw new Error(`analyze-inputs ${resp.status}`);
    const body = await resp.json();
    if (typeof body?.enrichedPrompt === "string") {
      return { enrichedPrompt: body.enrichedPrompt, analysis: body.analysis ?? null };
    }
    throw new Error("analyzer returned no enrichedPrompt");
  } catch (e) {
    console.warn("[analyzeAndBuildContext] falling back to raw context", e);
    return { enrichedPrompt: buildContextPrompt(basePrompt, tone, attachments), analysis: null };
  }
}

