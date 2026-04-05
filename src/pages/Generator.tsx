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
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    supabase.from("projects").select("id").limit(1)
      .then(({ error }) => {
        if (error) console.warn("Database handshake failed:", error.message);
      });
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
    } catch (err: any) {
      console.error("Generation Error:", err);
      setError(err.message || "An unexpected error occurred during generation.");
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
      setTimeout(() => setSaveState("idle"), 3000);
    } catch (err: any) {
      setSaveState("error");
      setError(err.message || "ARCHIVE_FAILED: Database rejected the entry.");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#020617] text-slate-200 font-sans">
      <aside className="w-56 flex-shrink-0 border-r border-white/5 flex flex-col bg-[#020617] z-30">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600/20 rounded flex items-center justify-center border border-blue-500/30">
            <Shield className="w-4 h-4 text-blue-400" />
          </div>
          <span className="font-bold tracking-tighter text-sm italic uppercase">NazAI // OS</span>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          <button onClick={() => navigate("/")} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 text-slate-400 transition-colors text-sm">
            <Home className="w-4 h-4" /> Home
          </button>
          <button onClick={() => navigate("/dashboard")} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 text-slate-400 transition-colors text-sm">
            <Clock className="w-4 h-4" /> Dashboard
          </button>
          <button onClick={() => navigate("/archives")} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 text-slate-400 transition-colors text-sm">
            <Archive className="w-4 h-4" /> Archives
          </button>
        </nav>
      </aside>

      <div className="w-64 flex-shrink-0 border-r border-white/5 bg-[#010411] z-20">
        <ModelSidebar activeModel={activeModel} onModelChange={setActiveModel} />
      </div>

      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-8 border-b border-white/5 bg-[#020617]/95 backdrop-blur-xl z-40">
          <div className="flex items-center gap-2 text-[10px] text-blue-400 font-mono tracking-widest uppercase">
            <ChevronRight className="w-3 h-3" />
            <span className="text-white/20">NazAI://</span> Mission_Control
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-purple-500" />
            <span className="text-[10px] font-black tracking-[0.3em] text-white uppercase">NazAI // V2.0</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 font-mono scrollbar-hide">
          <div className="max-w-4xl mx-auto">
            {generatedCode ? (
              <div className="relative group">
                {/* ── SAVE BUTTON: POSITIONED EXACTLY IN YOUR CIRCLED AREA ── */}
                <div className="absolute top-6 right-8 z-50 animate-in fade-in zoom-in duration-500">
                  <button 
                    onClick={handleSaveMission}
                    disabled={saveState === "saving" || saveState === "success"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all text-[10px] font-bold text-emerald-400 uppercase tracking-widest shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                  >
                    {saveState === "saving" ? <Loader2 className="animate-spin w-3 h-3" /> :
                     saveState === "success" ? <CheckCircle2 className="w-3 h-3" /> :
                     <DatabaseZap className="w-3 h-3" />}
                    {saveState === "saving" ? "Syncing" : saveState === "success" ? "Archived" : "Save Mission"}
                  </button>
                </div>

                <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl bg-black/40 backdrop-blur-sm">
                  <div className="bg-white/5 px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400 font-black">Live Solution Stream</span>
                    </div>
                  </div>
                  
                  <iframe srcDoc={generatedCode} className="w-full h-[600px] bg-white" title="preview" />
                </div>
              </div>
            ) : (
              <div className="h-[500px] flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-3xl text-slate-800">
                <Zap className="w-16 h-16 mb-6 opacity-5" />
                <p className="text-[10px] font-mono tracking-[0.5em] uppercase">Awaiting Directive Input</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-8 bg-gradient-to-t from-[#020617] to-transparent z-40">
          <div className={`max-w-4xl mx-auto rounded-2xl border transition-all duration-500 flex items-center px-4 py-1 ${focused ? "border-blue-500/40 bg-blue-500/5" : "border-white/10 bg-white/[0.02]"}`}>
            <Plus className="w-5 h-5 text-slate-600 ml-2" />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Inject mission directive..."
              className="flex-1 bg-transparent border-none outline-none py-5 px-4 text-sm text-slate-200 placeholder:text-slate-800 font-mono"
            />
            {loading ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin mr-4" /> : (
              <button onClick={handleGenerate} className="p-2 text-blue-500 hover:scale-110 active:scale-95 transition-all mr-2"><Zap className="w-6 h-6 fill-current" /></button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default GeneratorV2;
