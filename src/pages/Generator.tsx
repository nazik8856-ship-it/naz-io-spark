import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Home, Clock, Archive, Shield, ChevronRight, Zap, DatabaseZap, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ModelSidebar from "@/components/ModelSidebar";

const Generator = () => {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [activeModel, setActiveModel] = useState("gemini-2.0-flash");
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [hasResult, setHasResult] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setGeneratedCode("");
    setHasResult(false);
    try {
      const { data } = await supabase.functions.invoke("naz-io-spark", {
        body: { prompt: prompt.trim(), model_choice: activeModel },
      });
      setGeneratedCode(data.content || "Analysis complete.");
      setHasResult(true);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const handleSaveMission = async () => {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No User");
      await supabase.from("projects").insert({
        user_id: user.id,
        title: prompt.slice(0, 50),
        html: generatedCode,
        prompt: prompt,
        status: "active"
      });
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (e) { 
      console.error("Save error:", e);
      setSaveState("idle"); 
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#020617] text-slate-200 font-sans overflow-hidden">
      <aside className="w-56 border-r border-white/5 flex flex-col p-6 bg-[#020617] z-30">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-5 h-5 text-blue-400" />
          <span className="font-bold text-sm uppercase tracking-tighter italic">NazAI // OS</span>
        </div>
        <nav className="space-y-2">
          <button onClick={() => navigate("/")} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-white/5 text-sm text-slate-400"><Home className="w-4 h-4" /> Home</button>
          <button onClick={() => navigate("/dashboard")} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-white/5 text-sm text-slate-400"><Clock className="w-4 h-4" /> Dashboard</button>
          <button onClick={() => navigate("/archives")} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-white/5 text-sm text-slate-400"><Archive className="w-4 h-4" /> Archives</button>
        </nav>
      </aside>

      <div className="w-64 border-r border-white/5 bg-[#010411] z-20">
        <ModelSidebar activeModel={activeModel} onModelChange={setActiveModel} />
      </div>

      <main className="flex-1 flex flex-col relative">
        <header className="h-16 border-b border-white/5 flex items-center px-8 justify-between z-40 bg-[#020617]">
          <div className="text-[10px] text-blue-400 font-mono tracking-widest uppercase flex items-center gap-2"><ChevronRight className="w-3 h-3" /> Mission_Control</div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 relative scrollbar-hide">
          <div className="max-w-4xl mx-auto pb-20">
            {/* THIS BUTTON WILL NOW BE FORCED INTO THE DOM */}
            {hasResult && !loading && (
              <div className="flex justify-end mb-6 sticky top-0 z-[9999] bg-[#020617] py-4">
                <button 
                  onClick={handleSaveMission}
                  disabled={saveState !== "idle"}
                  className="flex items-center gap-3 px-6 py-3 rounded-xl border-4 border-emerald-500 bg-emerald-500/20 text-emerald-400 text-xs font-black uppercase shadow-[0_0_30px_rgba(16,185,129,0.5)] transition-all active:scale-95"
                >
                  {saveState === "saving" ? <Loader2 className="animate-spin w-4 h-4" /> : <DatabaseZap className="w-4 h-4" />}
                  {saveState === "success" ? "MISSION SAVED" : "SAVE TO DATABASE"}
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-black/40 p-10 min-h-[500px]">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-[400px]"><Loader2 className="animate-spin w-10 h-10 text-blue-500 mb-4" /></div>
              ) : hasResult ? (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center gap-2 mb-6"><Sparkles className="w-4 h-4 text-emerald-400" /><span className="text-xs text-emerald-400 uppercase font-bold">Analysis Ready</span></div>
                  <h1 className="text-3xl font-bold mb-6 text-white uppercase">{prompt}</h1>
                  <div className="text-slate-400 leading-relaxed font-sans text-lg">{generatedCode}</div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[400px] opacity-20"><Zap className="w-12 h-12 mb-4" /><p className="text-xs uppercase tracking-[0.5em]">System Ready</p></div>
              )}
            </div>
          </div>
        </div>

        <div className="p-8 bg-gradient-to-t from-[#020617] to-transparent z-40">
          <div className="max-w-4xl mx-auto rounded-2xl border border-white/10 bg-white/[0.02] flex items-center px-6 py-2">
            <Plus className="w-5 h-5 text-slate-800 ml-2" />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Inject mission directive..."
              className="flex-1 bg-transparent border-none outline-none py-5 text-sm text-slate-200 font-mono"
            />
            <button onClick={handleGenerate} className="text-blue-500 hover:scale-110"><Zap className="w-7 h-7 fill-current" /></button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Generator;
