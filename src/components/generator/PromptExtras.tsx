import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, SlidersHorizontal, X, Upload, Link2, Box, FileSpreadsheet, Database, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type Attachment = {
  id: string;
  label: string;
  contextText: string; // what gets appended to the prompt
};

interface Props {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  tone: string | null;
  onToneChange: (t: string | null) => void;
}

const TONES = ["Playful", "Professional", "Luxury", "Minimal", "Bold"];
const INTEGRATIONS = [
  { id: "gmail", label: "Gmail" },
  { id: "google_docs", label: "Google Docs" },
  { id: "google_sheets", label: "Google Sheets" },
  { id: "google_calendar", label: "Google Calendar" },
  { id: "google_analytics", label: "Google Analytics" },
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

  // Load connected integrations + latest snapshot summary when tuner opens
  useEffect(() => {
    if (!tunerOpen || !user?.id || connected.length) return;
    (async () => {
      const { data: ints } = await supabase
        .from("agent_integrations")
        .select("provider")
        .eq("user_id", user.id)
        .eq("status", "connected");
      const providers = Array.from(new Set((ints || []).map((i: any) => String(i.provider).toLowerCase())));
      if (!providers.length) { setConnected([]); return; }
      const { data: snaps } = await supabase
        .from("integration_snapshots")
        .select("provider, summary, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      const byProv = new Map<string, string>();
      (snaps || []).forEach((s: any) => {
        const p = String(s.provider).toLowerCase();
        if (!byProv.has(p)) byProv.set(p, typeof s.summary === "string" ? s.summary : JSON.stringify(s.summary));
      });
      setConnected(providers.map((p) => ({ provider: p, hasSnapshot: byProv.has(p), snapshotText: byProv.get(p) })));
    })();
  }, [tunerOpen, user?.id, connected.length]);

  const add = (a: Attachment) => onChange([...attachments, a]);
  const remove = (id: string) => onChange(attachments.filter((a) => a.id !== id));

  const handleFiles = async (files: FileList | null, isCsv: boolean) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const isText = /\.(csv|txt|md|json|tsv|log|xml|yaml|yml)$/i.test(f.name) || f.type.startsWith("text/");
      if (isText && f.size < 500_000) {
        try {
          const txt = await readFileAsText(f);
          const snippet = txt.length > 6000 ? txt.slice(0, 6000) + "\n…(truncated)" : txt;
          add({
            id: crypto.randomUUID(),
            label: `${isCsv ? "Data" : "File"} · ${f.name}`,
            contextText: `${isCsv ? "Imported data" : "Attached file"} "${f.name}":\n${snippet}`,
          });
        } catch {
          toast.error(`Couldn't read ${f.name}`);
        }
      } else {
        add({
          id: crypto.randomUUID(),
          label: `${f.type.startsWith("image/") ? "Image" : "File"} · ${f.name}`,
          contextText: `${f.type.startsWith("image/") ? "Reference image" : "File"} attached: ${f.name} (${Math.round(f.size / 1024)}KB, ${f.type || "unknown"}). Use context clues from the filename.`,
        });
      }
    }
  };

  const attachUrl = () => {
    const u = urlInput.trim();
    if (!u) return;
    add({
      id: crypto.randomUUID(),
      label: `URL · ${u.slice(0, 40)}`,
      contextText: `Reference URL for inspiration/context: ${u}`,
    });
    setUrlInput("");
    setPlusOpen(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* + button */}
      <div className="relative" ref={plusRef}>
        <button
          type="button"
          onClick={() => { setPlusOpen((v) => !v); setTunerOpen(false); }}
          className="h-8 w-8 rounded-full bg-white/5 border border-white/10 hover:border-purple-400/50 flex items-center justify-center text-zinc-300"
          title="Attach"
        >
          <Plus className="h-4 w-4" />
        </button>
        {plusOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur-xl p-3 z-50 shadow-2xl">
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
          </div>
        )}
      </div>

      {/* sliders button */}
      <div className="relative" ref={tunerRef}>
        <button
          type="button"
          onClick={() => { setTunerOpen((v) => !v); setPlusOpen(false); }}
          className="h-8 w-8 rounded-full bg-white/5 border border-white/10 hover:border-purple-400/50 flex items-center justify-center text-zinc-300"
          title="Tune"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        {tunerOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur-xl p-3 z-50 shadow-2xl">
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
                const c = connected.find((x) => x.provider === i.id || x.provider.includes(i.id.split("_")[1] || i.id));
                const already = attachments.some((a) => a.id === `int-${i.id}`);
                return (
                  <button
                    key={i.id}
                    disabled={!c || already}
                    onClick={() => {
                      if (!c) return;
                      add({
                        id: `int-${i.id}`,
                        label: `Data · ${i.label}`,
                        contextText: c.hasSnapshot && c.snapshotText
                          ? `Live data from ${i.label} (connected):\n${c.snapshotText.slice(0, 3000)}`
                          : `User has ${i.label} connected via OAuth. Assume relevant data is available and shape output accordingly.`,
                      });
                      setTunerOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-2 text-zinc-300">
                      <Database className="h-3.5 w-3.5 text-purple-300" /> {i.label}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {already ? <Check className="h-3 w-3 inline text-emerald-400" /> : c ? "connected" : "not connected"}
                    </span>
                  </button>
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
          </div>
        )}
      </div>

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
