import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Plus, Home, Clock, Archive, Shield, ChevronRight, Zap, DatabaseZap, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ModelSidebar from "@/components/ModelSidebar";

const Generator = () => {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [activeModel, setActiveModel] = useState("gemini-2.0-flash");
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [saveState, setSaveState] = useState("idle");

  // ── SYSTEM DIAGNOSTIC ──
  useEffect(() => {
    console.log("--- NAZ_OS_STATUS ---");
    console.log("DATA_FOUND:", generatedCode.length > 0);
    console.log("LOAD_ACTIVE:", loading);
    console.log("PORTAL_READY:", !!document.body);
  }, [generatedCode, loading]);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setGeneratedCode(""); 
    
    try {
      const { data, error } = await supabase.functions.invoke("naz-io-spark", {
        body: { prompt: prompt.trim(), model_choice: activeModel },
      });

      console.log("RAW_UPLINK:", data);

      if (error) throw error;
      
      // FIX: Robust Content Extraction
      // Ensures that even if the AI returns a raw string or a nested object, we get the text.
      let finalContent = "";
      if (typeof data === 'string') {
        finalContent = data;
      } else if (data?.content) {
        finalContent = data.content;
      } else if (data?.choices?.[0]?.message?.content) {
        finalContent = data.choices[0].message.content;
      } else {
        finalContent = JSON.stringify(data); // Fallback to stringified JSON
      }

      setGeneratedCode(finalContent);
    } catch (err) { 
      console.error("UPLINK_CRASH:", err);
      setGeneratedCode("ERROR: CONNECTION_LOST_RETRY_MANTLE");
    } finally { 
      setLoading(false); 
    }
  };

  const handleSaveMission = async () => {
    if (saveState === "saving" || !generatedCode) return;
    setSaveState("saving");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert("CRITICAL: AUTH_REQUIRED");
        setSaveState("idle");
        return;
      }

      const { error } = await supabase.from("projects").insert({
        user_id: user.id,
        title: prompt.slice(0, 50),
        html: generatedCode,
        prompt: prompt,
        status: "active"
      });

      if (error) throw error;
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (e) { 
      console.error("SYNC_FAILURE:", e);
      setSaveState("idle"); 
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#020617] text-slate-200 font-sans overflow-hidden relative">
      
      {/* ── SYSTEM STATUS BANNER ── */}
      <div className="fixed top-0 left-0 bg-emerald-600 text-white z-[9999] p-2 text-[9px] font-black uppercase tracking-[0.3em]">
        NAZ_OS // STABLE_BUILD_V3
      </div>

      {/* Navigation */}
      <aside className="w-56 border-r border-white/5 flex flex-col p-6 bg-[#020617] z-30">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-5 h-5 text-blue-400" />
          <span className="font-bold text-sm uppercase tracking-tighter italic">NazAI // OS</span>
        </div>
        <nav className="space-y-2">
          <button onClick={() => navigate("/")} className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/5 text-xs font-bold text-slate-400 transition-all uppercase tracking-widest"><Home className="w-4 h-4" /> Home</button>
          <button onClick={() => navigate("/dashboard")} className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/5 text-xs font-bold text-slate-400 transition-all uppercase tracking-widest"><Clock className="w-4 h-4" /> Recents</button>
          <button onClick={() => navigate("/archives")} className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/5 text-xs font-bold text-slate-400 transition-all uppercase tracking-widest"><Archive className="w-4 h-4" /> Archives</button>
        </nav>
      </aside>

      {/* Models */}
      <div className="w-64 border-r border-white/5 bg-[#010411] z-20">
        <ModelSidebar activeModel={activeModel} onModelChange={setActiveModel} />
      </div>

      <main className="flex-1 flex flex-col relative overflow-hidden bg-[#020617]">
        <header className="h-16 border-b border-white/5 flex items-center px-8 z-40 bg-[#020617]/80 backdrop-blur-md">
          <div className="text-[10px] text-blue-400 font-mono tracking-[0.4em] uppercase flex items-center gap-2">
            <ChevronRight className="w-3 h-3" /> SECURE_NODE // {activeModel.toUpperCase()}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 relative scrollbar-hide">
          <div className="max-w-4xl mx-auto pb-64">
            <div className="rounded-3xl border border-white/10 bg-black/40 p-12 min-h-[600px] shadow-2xl backdrop-blur-3xl relative overflow-hidden">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-[450px]">
                  <Loader2 className="animate-spin w-12 h-12 text-blue-500 mb-6" />
                  <p className="text-[10px] uppercase tracking-[0.5em] text-blue-400 animate-pulse">Syncing Neural Network...</p>
                </div>
              ) : generatedCode ? (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex items-center gap-2 mb-8 border-b border-white/5 pb-4">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] text-emerald-400 uppercase font-black tracking-[0.2em]">Uplink_Established</span>
                  </div>
                  <h1 className="text-4xl font-black mb-8 text-white uppercase tracking-tighter leading-none border-l-4 border-emerald-500 pl-6">{prompt}</h1>
                  <div className="text-slate-300 leading-relaxed font-sans text-lg whitespace-pre-wrap">{generatedCode}</div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[450px] opacity-10">
                  <Zap className="w-16 h-16 mb-6" />
                  <p className="text-[10px] uppercase tracking-[1em]">Core_Standby</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Input Bar */}
        <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#020617] via-[#020617] to-transparent z-40 pointer-events-none">
          <div className="max-w-4xl mx-auto rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl flex items-center px-6 py-2 shadow-2xl pointer-events-auto">
            <Plus className="w-5 h-5 text-slate-700 mr-2" />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Inject mission directive..."
              className="flex-1 bg-transparent border-none outline-none py-6 text-base text-slate-100 font-mono placeholder:text-slate-800"
            />
            <button onClick={handleGenerate} disabled={loading} className="text-emerald-500 hover:scale-110 active:scale-95 transition-all disabled:opacity-20">
              <Zap className="w-8 h-8 fill-current" />
            </button>
          </div>
        </div>
      </main>

      {/* ── THE ASCENDED PORTAL BUTTON ── */}
      {/* This renders at the very bottom of the <body>, ignoring all NazAI CSS constraints */}
      {(generatedCode.length > 0 || loading) && createPortal(
        <div className="fixed top-8 right-8 z-[1000000] animate-in fade-in zoom-in duration-300">
          <button 
            onClick={handleSaveMission}
            disabled={saveState !== "idle"}
            className={`
              flex items-center gap-4 px-10 py-6 rounded-2xl font-black uppercase tracking-[0.2em] text-xs
              border-4 border-white shadow-[0_0_60px_rgba(16,185,129,0.4)]
              hover:scale-105 active:scale-95 transition-all cursor-pointer
              ${saveState === 'success' ? 'bg-blue-600' : 'bg-emerald-500'}
              text-white
            `}
          >
            {saveState === "saving" ? <Loader2 className="animate-spin w-5 h-5" /> : <DatabaseZap className="w-5 h-5" />}
            {saveState === "success" ? "DATA_ARCHIVED" : "FORCE_SAVE_MISSION"}
          </button>
        </div>,
        document.body
      )}

    </div>
  );
};

export default Generator;
