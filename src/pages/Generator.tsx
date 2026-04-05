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
  DatabaseZap,
  CheckCircle2,
  Loader2,
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
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [hasResult, setHasResult] = useState<boolean>(false);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
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
        setGeneratedCode(content); // Store plain text if no HTML
      }
      
      setHasResult(true);
    } catch (err: any) {
      console.error("Generation error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMission = async () => {
    if (saveState === "saving") return;
    setSaveState("saving");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Auth Required");

      const { error: insertError } = await supabase.from("projects").insert({
        user_id: user.id,
        title: prompt.trim().slice(0, 50) || "New Mission",
        html: generatedCode.includes("<html") ? generatedCode : `<div>${generatedCode}</div>`,
        prompt: prompt.trim(),
        status: "active",
      });

      if (insertError) throw new Error(insertError.message);
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err: any) {
      console.error("Save error:", err);
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2000);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#020617] text-slate-200 font-sans">
      {/* Sidebar */}
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

      {/* Model Selector */}
      <div className="w-64 flex-shrink-0 border-r border-white/5 bg-[#010411] z-20">
        <ModelSidebar activeModel={activeModel} onModelChange={setActiveModel} />
      </div>

      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-8 border-b border-white/5 z-40 bg-[#020617]">
          <div className="text-[10px] text-blue-400 font-mono tracking-widest uppercase flex items-center gap-2">
            <ChevronRight className="w-3 h-3" /> Mission_Control
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono font-bold">
            SYSTEM_STATUS: <span className={loading ? "text-yellow-500" : "text-emerald-500"}>{loading ? "BUSY" : "ONLINE"}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 font-mono relative scrollbar-hide">
          <div className="max-w-4xl mx-auto pb-32">
            
            {hasResult && !loading && (
              <div className="relative animate-in fade-in slide-in-from-bottom-6 duration-700">
                
                {/* ── MANDATORY SAVE BUTTON: FORCED STACKING ── */}
                <div className="flex justify-end mb-4 sticky top-0 z-[999] pt-2">
                   <button 
                    onClick={handleSaveMission}
                    disabled={saveState === "saving" || saveState === "success"}
                    className="flex items-center gap-3 px-6 py-3 rounded-xl border-2 border-emerald-500 bg-[#020617] hover:bg-emerald-500/10 text-emerald-400 text-xs font-black uppercase tracking-[0.2em] shadow-[0_0_50px_rgba(16,185,129,0.3)] transition-all active:scale-95"
                  >
                    {saveState === "saving" ? <Loader2 className="animate-spin w-4 h-4" /> :
                     saveState === "success" ? <CheckCircle2 className="w-4 h-4" /> :
                     <DatabaseZap className="w-4 h-4" />}
                    <span>{saveState === "saving" ? "ARCHIVING..." : saveState === "success" ? "MISSION SAVED" : "COMMIT TO DATABASE"}</span>
                  </button>
                </div>

                <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/60 shadow-2xl">
                  <div className="bg-white/5 px-6 py-4 border-b border-white/10 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-bold">Output Stream</span>
                  </div>
                  
                  {generatedCode.includes("<html") ? (
                    <iframe srcDoc={generatedCode} className="w-full h-[600px] bg-white" title="preview" />
                  ) : (
                    <div className="p-8 text-slate-300 bg-[#010411]">
                      <div className="flex items-center gap-2 mb-4 text-emerald-400">
                        <Sparkles className="w-4 h-4" />
                        <span className="text-[10px] uppercase font-black">Data Decrypted</span>
                      </div>
                      <h2 className="text-xl font-bold mb-4 text-white border-b border-white/5 pb-4">{prompt}</h2>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap font-sans text-slate-400">
                        {generatedCode || "No data returned from mission control."}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!hasResult && !loading && (
              <div className="h-[400px] flex flex-col items-center justify-center border border-dashed border-white/5 rounded-3xl opacity-20">
                <Zap className="w-12 h-12 mb-4 text-blue-500" />
                <p className="text-xs uppercase tracking-[0.5em]">Command Input Required</p>
              </div>
            )}
            
            {loading && (
              <div className="h-[400px] flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-6" />
                <p className="text-[10px] uppercase tracking-[0.5em] text-blue-400 animate-pulse">Running Mission Algorithms...</p>
              </div>
            )}
          </div>
        </div>

        {/* Input Bar */}
        <div className="p-8 bg-gradient-to-t from-[#020617] via-[#020617] to-transparent z-40">
          <div className={`max-w-4xl mx-auto rounded-2xl border transition-all duration-300 flex items-center px-4 py-1 ${focused ? "border-blue-500/50 bg-blue-500/5 shadow-[0_0_40px_rgba(59,130,246,0.15)]" : "border-white/10 bg-white/[0.02]"}`}>
            <Plus className="w-5 h-5 text-slate-800 ml-2" />
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
