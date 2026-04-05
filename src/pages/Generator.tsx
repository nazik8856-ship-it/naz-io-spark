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
  const [hasResult, setHasResult] = useState<boolean>(false);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setGeneratedCode("");
    setHasResult(false);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("naz-io-spark", {
        body: {
          prompt: prompt.trim(),
          model_choice: activeModel,
          repo: "nazik8856-ship-it/naz-io-spark",
        },
      });

      if (fnError) throw new Error(fnError.message);

      const content = data.content ?? "";
      if (content.toLowerCase().includes("<html") || content.includes("```html")) {
        const clean = extractHTML(content);
        setGeneratedCode(wrapInSkeleton(clean));
      } else {
        setGeneratedCode(""); 
      }
      
      setHasResult(true);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMission = async () => {
    if ((!generatedCode && !hasResult) || saveState === "saving") return;
    setSaveState("saving");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Auth Required");

      const { error: insertError } = await supabase.from("projects").insert({
        user_id: user.id,
        title: prompt.trim().slice(0, 50) || "New Mission",
        html: generatedCode || "Strategic Analysis Data",
        prompt: prompt.trim(),
        status: "active",
      });

      if (insertError) throw new Error(insertError.message);
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err: any) {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2000);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#020617] text-slate-200 font-sans">
      <aside className="w-56 flex-shrink-0 border-r border-white/5 flex flex-col bg-[#020617] z-30">
        <div className="p-6 flex items-center gap-3">
           <Shield className="w-5 h-5 text-blue-400" />
           <span className="font-bold text-sm italic uppercase tracking-tighter">NazAI // OS</span>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          <button onClick={() => navigate("/")} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-white/5 text-slate-400 text-sm"><Home className="w-4 h-4" /> Home</button>
          <button onClick={() => navigate("/dashboard")} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-white/5 text-slate-400 text-sm"><Clock className="w-4 h-4" /> Dashboard</button>
          <button onClick={() => navigate("/archives")} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-white/5 text-slate-400 text-sm"><Archive className="w-4 h-4" /> Archives</button>
        </nav>
      </aside>

      <div className="w-64 flex-shrink-0 border-r border-white/5 bg-[#010411] z-20">
        <ModelSidebar activeModel={activeModel} onModelChange={setActiveModel} />
      </div>

      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-8 border-b border-white/5 z-40 bg-[#020617]/50 backdrop-blur-md">
          <div className="text-[10px] text-blue-400 font-mono tracking-widest uppercase flex items-center gap-2">
            <ChevronRight className="w-3 h-3" /> Mission_Control
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
            STATUS: <span className={loading ? "text-yellow-500" : "text-emerald-500"}>{loading ? "PROCESSING" : "READY"}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 font-mono relative scrollbar-hide">
          <div className="max-w-4xl mx-auto pb-32">
            {hasResult && !loading && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                
                {/* ── EMERGENCY SAVE BUTTON: FORCED VISIBILITY ── */}
                <div className="flex justify-end mb-6 sticky top-0 z-[100] pt-2">
                   <button 
                    onClick={handleSaveMission}
                    disabled={saveState === "saving" || saveState === "success"}
                    className="flex items-center gap-3 px-6 py-3 rounded-xl border-2 border-emerald-500 bg-[#061a11] hover:bg-[#0c3221] text-emerald-400 text-xs font-black uppercase tracking-[0.2em] shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all active:scale-95 ring-4 ring-black/50"
                  >
                    {saveState === "saving" ? <Loader2 className="animate-spin w-4 h-4" /> :
                     saveState === "success" ? <CheckCircle2 className="w-4 h-4" /> :
                     <DatabaseZap className="w-4 h-4" />}
                    <span>{saveState === "saving" ? "SYNCING..." : saveState === "success" ? "MISSION ARCHIVED" : "SAVE TO DATABASE"}</span>
                  </button>
                </div>

                <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/60 shadow-2xl backdrop-blur-md">
                  <div className="bg-white/5 px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400 font-black">Mission Directive Result</span>
                    </div>
                  </div>
                  
                  {generatedCode ? (
                    <iframe srcDoc={generatedCode} className="w-full h-[650px] bg-white" title="preview" />
                  ) : (
                    <div className="p-10 text-slate-300">
                      <div className="flex items-center gap-2 mb-6">
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs text-emerald-400 uppercase tracking-widest font-bold">Analysis Complete</span>
                      </div>
                      <h2 className="text-2xl font-bold mb-4 text-white uppercase tracking-tighter">{prompt}</h2>
                      <div className="p-8 bg-white/[0.03] border border-white/5 rounded-2xl leading-relaxed text-slate-400 font-sans">
                        Mission directive parameters successfully computed. The logic has been injected into the control stream.
                        <br /><br />
                        <span className="text-emerald-500 font-bold underline">ATTENTION:</span> Use the floating button above to commit this analysis to the permanent archive.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!hasResult && !loading && (
              <div className="h-[500px] flex flex-col items-center justify-center border border-dashed border-white/5 rounded-3xl opacity-20">
                <Zap className="w-12 h-12 mb-4" />
                <p className="text-xs uppercase tracking-[0.5em]">Awaiting Instruction</p>
              </div>
            )}
            
            {loading && (
              <div className="h-[500px] flex flex-col items-center justify-center">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
                <p className="text-[10px] uppercase tracking-[0.4em] text-blue-400 animate-pulse">Computing Mission Vectors...</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-8 bg-gradient-to-t from-[#020617] via-[#020617] to-transparent z-40">
          <div className={`max-w-4xl mx-auto rounded-2xl border transition-all duration-300 flex items-center px-4 py-1 ${focused ? "border-blue-500/40 bg-blue-500/5 shadow-[0_0_40px_rgba(59,130,246,0.1)]" : "border-white/10 bg-white/[0.02]"}`}>
            <Plus className="w-5 h-5 text-slate-700 ml-2" />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Inject mission directive..."
              className="flex-1 bg-transparent border-none outline-none py-5 px-4 text-sm text-slate-200 placeholder:text-slate-800 font-mono"
            />
            {!loading && (
              <button onClick={handleGenerate} className="p-2 text-blue-500 hover:scale-110 transition-all mr-2">
                <Zap className="w-6 h-6 fill-current" />
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default GeneratorV2;
