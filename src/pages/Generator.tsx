import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Home,
  Clock,
  Archive,
  Shield,
  ChevronRight,
  Sparkles,
  Zap,
  AlertCircle,
  Github,
  DatabaseZap,
  CheckCircle2,
  Loader2,
  Download,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ModelSidebar from "@/components/ModelSidebar";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHTML(raw: string): string {
  return raw
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function wrapInSkeleton(html: string): string {
  const lower = html.toLowerCase();
  if (lower.includes("<!doctype") || lower.includes("<html")) return html;
  return `<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script><style>body { background: #0a0a0a; color: #f1f5f9; min-height: 100vh; font-family: sans-serif; }</style></head><body>${html}</body></html>`;
}

type SaveState = "idle" | "saving" | "success" | "error";

const GeneratorV2 = () => {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState<string>("");
  const [activeModel, setActiveModel] = useState<string>("gemini-2.0-flash");
  const [loading, setLoading] = useState<boolean>(false);
  const [generatedCode, setGeneratedCode] = useState<string>("");
  const [focused, setFocused] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dbOnline, setDbOnline] = useState<boolean>(false);

  // ── Save state machine ──
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // ── Check DB on mount ──
  useEffect(() => {
    supabase.from("profiles").select("id").limit(1)
      .then(({ error }) => setDbOnline(!error))
      .catch(() => setDbOnline(false));
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSaveState("idle");

    try {
      const { data, error: fnError } = await supabase.functions.invoke("naz-io-spark", {
        body: {
          prompt: prompt.trim(),
          model_choice: activeModel,
          repo: "nazik8856-ship-it/naz-io-spark",
        },
      });

      if (fnError) throw new Error(fnError.message);

      const clean = extractHTML(data.content ?? "");
      const full = wrapInSkeleton(clean);
      setGeneratedCode(full);

      const blob = new Blob([full], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err: any) {
      console.error("Generation Error:", err);
      setError(err.message || "An unexpected error occurred during decryption.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMission = async () => {
    if (!generatedCode || saveState === "saving") return;
    setSaveState("saving");
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Authentication Required: Access Denied.");

      const { error: insertError } = await supabase.from("projects").insert({
        user_id: user.id,
        title: prompt.trim().slice(0, 80) || "Untitled Mission",
        html: generatedCode,
        prompt: prompt.trim(),
        status: "active",
      });

      if (insertError) throw new Error(insertError.message);

      setSaveState("success");
      setDbOnline(true);
      setTimeout(() => setSaveState("idle"), 3000);
    } catch (err: any) {
      setSaveState("error");
      setError(err.message || "ARCHIVE_FAILED: Database rejected the entry.");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([generatedCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazai-mission-${Date.now()}.html`;
    a.click();
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#020617] text-slate-200 font-sans">
      {/* ── SIDEBAR 1: OS NAV ── */}
      <aside className="w-56 flex-shrink-0 border-r border-white/5 flex flex-col bg-[#020617] z-30">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600/20 rounded flex items-center justify-center border border-blue-500/30">
            <Shield className="w-4 h-4 text-blue-400" />
          </div>
          <span className="font-bold tracking-tighter text-sm italic uppercase">NazAI // OS</span>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          <button
            onClick={() => navigate("/")}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 text-slate-400 transition-colors text-sm"
          >
            <Home className="w-4 h-4" /> Home
          </button>
          <button
            onClick={() => navigate("/recents")}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 text-slate-400 transition-colors text-sm"
          >
            <Clock className="w-4 h-4" /> Recents
          </button>
          <button
            onClick={() => navigate("/archives")}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 text-slate-400 transition-colors text-sm"
          >
            <Archive className="w-4 h-4" /> Archives
          </button>
        </nav>

        <div className="p-6 border-t border-white/5">
          <div className="text-[10px] text-slate-500 uppercase tracking-[0.2em] mb-4 font-bold">Connected Repo</div>
          <div className="text-xs text-slate-300 flex items-center gap-2 group cursor-pointer font-mono">
            <Github className="w-3 h-3 text-slate-500" />
            <span className="truncate group-hover:text-blue-400 transition-colors">nazik8856-ship-it</span>
          </div>
        </div>
      </aside>

      {/* ── SIDEBAR 2: MODELS ── */}
      <div className="w-64 flex-shrink-0 border-r border-white/5 bg-[#010411] z-20">
        <ModelSidebar activeModel={activeModel} onModelChange={setActiveModel} />
      </div>

      {/* ── MAIN WORKSPACE ── */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-8 border-b border-white/5 bg-[#020617]/95 backdrop-blur-xl z-40">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-[10px] text-blue-400 font-mono tracking-widest uppercase">
              <ChevronRight className="w-3 h-3" />
              <span className="text-white/20">NazAI://</span> Mission_Control
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-purple-500" />
            <span className="text-[10px] font-black tracking-[0.3em] text-white uppercase">NazAI // V2.0</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 font-mono scrollbar-hide">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="space-y-1 mb-6 animate-in fade-in duration-1000">
              <div className="text-[9px] text-blue-500/50 flex gap-2">
                <span className="opacity-50">[SYSTEM]</span>
                <span>SESSION_ESTABLISHED // NODE_READY</span>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400 text-xs uppercase tracking-tighter">
                <AlertCircle className="w-4 h-4" />
                <span>CRITICAL ERROR: {error}</span>
              </div>
            )}

            {generatedCode && (
              <div className="rounded-xl border border-white/10 overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Live Preview</span>
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500/40" />
                    <div className="w-2 h-2 rounded-full bg-yellow-500/40" />
                    <div className="w-2 h-2 rounded-full bg-green-500/40" />
                  </div>
                </div>
                <iframe srcDoc={generatedCode} className="w-full h-[550px] bg-white" title="preview" />

                <div className="bg-[#010d1f] border-t border-white/5 px-6 py-4 flex items-center justify-between gap-4">
                   <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                    <ChevronRight className="w-3 h-3 text-emerald-600" />
                    <span>DATA_STREAM_STABLE</span>
                  </div>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 text-[10px] font-mono uppercase hover:bg-white/10 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── FLOATING SAVE BUTTON (Conditional on generatedCode AND workspace path) ── */}
        {generatedCode && window.location.pathname.includes('workspace') && (
          <div className="fixed bottom-32 right-12 z-[100] group">
            <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 rounded-lg text-xs font-mono whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-[#020617]/95 border border-blue-500/20 text-white/70">
              Archive to NazAI Database
            </div>
            <button
              onClick={handleSaveMission}
              disabled={saveState === "saving" || saveState === "success"}
              className="flex items-center gap-3 px-6 py-3.5 rounded-full border-2 shadow-[0_0_30px_rgba(0,0,0,0.5)] transition-all active:scale-95 duration-300 disabled:cursor-not-allowed"
              style={{
                borderColor: saveState === "success" ? "#22c55e" : saveState === "error" ? "#ef4444" : saveState === "saving" ? "#eab308" : "rgba(16,185,129,0.5)",
                background: saveState === "success" ? "rgba(34,197,94,0.15)" : saveState === "error" ? "rgba(239,68,68,0.15)" : saveState === "saving" ? "rgba(234,179,8,0.1)" : "rgba(16,185,129,0.12)",
                color: saveState === "success" ? "#22c55e" : saveState === "error" ? "#ef4444" : saveState === "saving" ? "#eab308" : "#10b981",
              }}
            >
              {saveState === "saving" ? <Loader2 className="animate-spin w-5 h-5" /> :
               saveState === "success" ? <CheckCircle2 className="w-5 h-5" /> :
               saveState === "error" ? <XCircle className="w-5 h-5" /> :
               <DatabaseZap className="w-5 h-5" />}
              <span className="font-bold uppercase tracking-[0.2em] text-[11px]">
                {saveState === "saving" ? "Syncing..." : saveState === "success" ? "Saved ✓" : saveState === "error" ? "Error — Retry" : "Save to Database"}
              </span>
            </button>
          </div>
        )}

        {/* Input Dock */}
        <div className="p-8 bg-gradient-to-t from-[#020617] via-[#020617] to-transparent z-40">
          <div className={`max-w-4xl mx-auto rounded-2xl border transition-all duration-500 flex items-center px-4 py-1 ${focused ? "border-blue-500/40 bg-blue-500/5 shadow-[0_0_50px_rgba(0,163,255,0.05)]" : "border-white/10 bg-white/[0.02]"}`}>
            <button className="p-2 text-slate-600 hover:text-blue-400 transition-colors">
              <Plus className="w-5 h-5" />
            </button>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Inject mission directive..."
              className="flex-1 bg-transparent border-none outline-none py-4 px-4 text-sm text-slate-200 placeholder:text-slate-700 font-mono"
            />
            {loading ? (
              <div className="w-5 h-5 border-2 border-blue-500/20 border-t-blue-500 animate-spin rounded-full mr-2" />
            ) : (
              <button onClick={handleGenerate} className="p-2 text-blue-500 hover:scale-110 active:scale-95 transition-all">
                <Zap className="w-5 h-5 fill-current" />
              </button>
            )}
          </div>

          {/* SYSTEM STATUS FOOTER */}
          <div className="max-w-4xl mx-auto flex items-center justify-between mt-4 px-2">
            <p className="text-[9px] text-slate-700 tracking-[0.2em] uppercase font-mono">Core: NazAI Neural Router</p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: dbOnline ? "#22c55e" : "rgba(255,255,255,0.2)", boxShadow: dbOnline ? "0 0 8px rgba(34,197,94,0.5)" : "none" }} />
                <span className="text-[8px] text-slate-500 uppercase">{dbOnline ? "System: Nominal" : "DB: Offline"}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default GeneratorV2;
