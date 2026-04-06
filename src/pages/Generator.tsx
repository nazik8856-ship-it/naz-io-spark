import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Plus, Home, Clock, Archive, Shield, ChevronRight, Zap, DatabaseZap, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ModelSidebar from "@/components/ModelSidebar";
import { toast } from "sonner";

const Generator = () => {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [activeModel, setActiveModel] = useState("gemini-2.0-flash");
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [mounted, setMounted] = useState(false);

  // ── MOUNT CHECK ──
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // ── SYSTEM DIAGNOSTIC ──
  useEffect(() => {
    if (generatedCode || loading) {
      console.log("--- NAZ_OS_RECON ---");
      console.log("CONTENT_BUFFER:", generatedCode.length);
      console.log("ACTIVE_LOAD:", loading);
    }
  }, [generatedCode, loading]);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setGeneratedCode(""); 
    
    try {
      // ── UPDATED FUNCTION INVOCATION ──
      // Pointing to the new mission processing function observed in dashboard
      const { data, error } = await supabase.functions.invoke("supabase-functions-new-process-mission", {
        body: { 
          prompt: prompt.trim(), 
          model_choice: activeModel 
        },
      });

      if (error) throw error;
      
      const content = data?.content || (typeof data === 'string' ? data : JSON.stringify(data));
      setGeneratedCode(content);
      toast.success("UPLINK_STABLE: Data Received");
    } catch (err) { 
      console.error("UPLINK_CRASH:", err);
      toast.error("UPLINK_CRASH: Re-establishing...");
    } finally { 
      setLoading(false); 
    }
  };

  // ── THE FULLY ALIGNED MISSION HANDLER ──
  const handleSaveMission = async () => {
    if (saveState === "saving" || !generatedCode) return;
    setSaveState("saving");
    
    try {
      // 1. Fresh session check to resolve 401 Unauthorized errors
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      
      if (authError || !session) {
        console.error("AUTH_FAIL:", authError);
        toast.error("SESSION_EXPIRED: Please log in again.");
        setSaveState("idle");
        return;
      }

      // Diagnostic: See what we are sending before we hit the wall
      console.table({
        table: "missions",
        user: session.user.id,
        directive_length: generatedCode.length,
        status: "completed"
      });

      // 2. Insert using verified column 'directive'
      const { error } = await supabase.from("missions").insert({
        user_id: session.user.id, // Verified policy: (auth.uid() = user_id)
        directive: generatedCode, // ALIGNED: Ensure this column exists in DB
        status: "completed"       
      });

      if (error) throw error;
      
      setSaveState("success");
      toast.success("MISSION_ARCHIVED");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (e) { 
      console.error("SYNC_CRASH:", e);
      toast.error("SYNC_CRASH: Check Console for Schema Mismatch");
      setSaveState("idle"); 
    }
  };
      
  return (
    <div className="flex h-screen bg-[#020617] text-white overflow-hidden">
      {/* ── STATUS OVERLAY ── */}
      <div className="fixed top-0 left-0 bg-blue-600 text-white z-[50] p-2 text-[9px] font-black uppercase tracking-[0.3em]">
        NAZ_OS // ENGINE_ACTIVE
      </div>

      <aside className="w-56 border-r border-white/5 flex flex-col p-6 bg-[#020617] z-30">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-5 h-5 text-blue-400" />
          <span className="font-bold text-sm uppercase tracking-tighter italic">NazAI // OS</span>
        </div>
        <nav className="space-y-1">
          {[
            { label: 'Home', icon: Home, path: '/' },
            { label: 'Recents', icon: Clock, path: '/dashboard' },
            { label: 'Archives', icon: Archive, path: '/archives' }
          ].map((item) => (
            <button 
              key={item.label}
              onClick={() => navigate(item.path)} 
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/5 text-[11px] font-bold text-slate-400 transition-all uppercase tracking-widest"
            >
              <item.icon className="w-4 h-4" /> {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="w-64 border-r border-white/5 bg-[#010411] z-20">
        <ModelSidebar activeModel={activeModel} onModelChange={setActiveModel} />
      </div>

      <main className="flex-1 flex flex-col relative overflow-hidden bg-[#020617]">
        <header className="h-16 border-b border-white/5 flex items-center px-8 z-40 bg-[#020617]/80 backdrop-blur-md">
          <div className="text-[10px] text-blue-400 font-mono tracking-[0.4em] uppercase flex items-center gap-2">
            <ChevronRight className="w-3 h-3" /> SECURE_NODE // SYNCHRONIZED
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 relative scrollbar-hide">
          <div className="max-w-4xl mx-auto pb-64">
            <div className="rounded-3xl border border-white/10 bg-black/40 p-12 min-h-[600px] shadow-2xl backdrop-blur-3xl relative">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-[450px]">
                  <Loader2 className="animate-spin w-12 h-12 text-blue-500 mb-6" />
                  <p className="text-[10px] uppercase tracking-[0.5em] text-blue-400 animate-pulse">Processing Neural Request...</p>
                </div>
              ) : generatedCode ? (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex items-center gap-2 mb-8 border-b border-white/5 pb-4">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] text-emerald-400 uppercase font-black tracking-[0.2em]">Output_Generated</span>
                  </div>
                  <h1 className="text-4xl font-black mb-8 text-white uppercase tracking-tighter leading-none">{prompt}</h1>
                  <div className="text-slate-300 leading-relaxed font-sans text-lg whitespace-pre-wrap">{generatedCode}</div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[450px] opacity-10">
                  <Zap className="w-16 h-16 mb-6" />
                  <p className="text-[10px] uppercase tracking-[1em]">Standby_Mode</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#020617] via-[#020617] to-transparent z-40 pointer-events-none">
          <div className="max-w-4xl mx-auto rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl flex items-center px-6 py-2 shadow-2xl pointer-events-auto">
            <Plus className="w-5 h-5 text-slate-800 mr-2" />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Enter directive..."
              className="flex-1 bg-transparent border-none outline-none py-6 text-base text-slate-100 font-mono placeholder:text-slate-800"
            />
            <button onClick={handleGenerate} disabled={loading} className="text-emerald-500 hover:scale-110 active:scale-95 transition-all disabled:opacity-20">
              <Zap className="w-8 h-8 fill-current" />
            </button>
          </div>
        </div>
      </main>

      {/* ── THE PORTAL ── */}
      {mounted && (generatedCode.length > 0 || loading) && createPortal(
        <div className="fixed top-6 right-6 z-[9999] animate-in fade-in slide-in-from-right-4 duration-500">
          <button 
            onClick={handleSaveMission}
            disabled={saveState !== "idle"}
            className={`
              flex items-center gap-4 px-8 py-5 rounded-2xl font-black uppercase tracking-widest text-[10px]
              border-2 border-white/20 shadow-2xl transition-all active:scale-95
              ${saveState === 'success' ? 'bg-blue-600 shadow-blue-500/40' : 'bg-emerald-600 shadow-emerald-500/40'}
              text-white
            `}
          >
            {saveState === "saving" ? <Loader2 className="animate-spin w-4 h-4" /> : <DatabaseZap className="w-4 h-4" />}
            {saveState === "success" ? "SYNCED" : "ARCHIVE_MISSION"}
          </button>
        </div>,
        document.body
      )}

    </div>
  );
};

export default Generator;
