import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Zap, Loader2, Play, Code, 
  Layout, Rocket, Sparkles, RefreshCcw,
  ArrowLeft, Terminal, Share2, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const Generator = () => {
  const navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'strategy'>('preview');

  const handleGenerate = async () => {
    if (!idea.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('swift-service', {
        body: { businessIdea: idea.trim() },
      });
      if (error) throw error;
      setResult(data);
    } catch (err) {
      console.error("Neural Link Error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30 font-sans overflow-x-hidden">
      {/* 48px Branding Grid - NazAI Signature */}
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#0ff 1px, transparent 1px), linear-gradient(90deg, #0ff 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

      <main className="relative z-10 max-w-7xl mx-auto p-6 space-y-8">
        
        {/* HEADER: NEON LOGO INTEGRATION */}
        <header className="flex justify-between items-center py-4 border-b border-white/5">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => navigate("/")}>
            <img 
              src="/logo.png" 
              alt="NazAI" 
              className="w-10 h-10 rounded-xl object-contain drop-shadow-[0_0_15px_rgba(0,255,255,0.3)]" 
            />
            <div className="flex flex-col">
              <h1 className="text-2xl font-black tracking-tighter uppercase italic leading-none">
                Naz<span className="text-emerald-400">AI</span>
              </div>
              <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-[0.3em]">Neural Interface v3.0</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Button variant="ghost" className="text-zinc-500 hover:text-white group">
              <RefreshCcw size={16} className="group-hover:rotate-180 transition-transform duration-500" />
            </皮>
            <Button onClick={() => navigate("/")} variant="outline" className="border-white/10 text-[10px] font-black uppercase tracking-widest px-4 h-8 rounded-lg hover:bg-white/5">
              <ArrowLeft size={12} className="mr-2" /> Exit
            </Button>
          </div>
        </header>

        {/* INPUT: THE LASER COMMAND BOX */}
        <section className="space-y-4">
          <div className="laser-border">
            <div className="laser-content p-1">
              <div className="flex flex-col md:flex-row gap-4 bg-[#050505] p-4 rounded-xl">
                <div className="flex-1 flex gap-4">
                  <div className="mt-4 text-emerald-500/50"><Terminal size={20} /></div>
                  <textarea
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="Describe your vision (e.g., 'A premium coffee subscription for developers')..."
                    className="flex-1 bg-transparent border-none text-cyan-50 p-4 text-lg font-mono focus:ring-0 placeholder:text-zinc-800 resize-none scrollbar-hide"
                    rows={3}
                  />
                </div>
                <div className="flex flex-col justify-end">
                  <Button 
                    onClick={handleGenerate}
                    disabled={loading || !idea}
                    className="h-full px-10 bg-emerald-500 text-black hover:bg-emerald-400 font-black rounded-xl transition-all active:scale-95 disabled:opacity-20 group"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <>
                        <Play fill="currentColor" size={18} className="mr-2 group-hover:scale-125 transition-transform" /> 
                        IGNITE
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-10 duration-1000">
            
            {/* SIDEBAR: BRAND & STRATEGY */}
            <aside className="lg:col-span-4 space-y-6">
              <div className="glass p-8 rounded-[32px] border-white/5">
                <div className="flex items-center gap-2 text-emerald-400 mb-6">
                  <Sparkles size={18} />
                  <h3 className="font-black uppercase tracking-widest text-xs italic">Brand Identity</h3>
                </div>
                <div className="space-y-6">
                  <div>
                    <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mb-1">Generated Name</p>
                    <p className="text-3xl font-black text-white tracking-tighter italic">{result.brand?.name}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mb-2">Visual Logic</p>
                    <p className="text-xs text-zinc-400 font-medium leading-relaxed italic border-l-2 border-emerald-500/30 pl-4">
                      {result.brand?.logoPrompt}
                    </p>
                  </div>
                </div>
              </div>

              <div className="glass p-8 rounded-[32px] border-white/5">
                <div className="flex items-center gap-2 text-cyan-400 mb-6">
                  <Rocket size={18} />
                  <h3 className="font-black uppercase tracking-widest text-xs italic">Growth Hooks</h3>
                </div>
                <ul className="space-y-4">
                  {result.strategy?.hooks?.map((hook: string, i: number) => (
                    <li key={i} className="text-[11px] text-zinc-400 font-bold uppercase tracking-tight flex gap-3 items-start">
                      <span className="text-cyan-500 font-mono mt-0.5">0{i+1}</span>
                      {hook}
                    </li>
                  ))}
                </ul>
              </div>

              <Button className="w-full h-12 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white/10">
                <Share2 size={14} className="mr-2" /> Share Project
              </Button>
            </aside>

            {/* MAIN VIEW: THE PREVIEW SYSTEM */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex justify-between items-center px-2">
                <div className="flex gap-4">
                  {['preview', 'code'].map((tab) => (
                    <button 
                      key={tab}
                      onClick={() => setActiveTab(tab as any)} 
                      className={`text-[10px] font-black uppercase tracking-[0.2em] transition-all pb-2 border-b-2 ${activeTab === tab ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-600'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-white">
                  <Download size={14} />
                </Button>
              </div>

              <div className="laser-border h-[650px]">
                <div className="laser-content">
                  {activeTab === 'preview' ? (
                    <div className="w-full h-full bg-white rounded-xl overflow-hidden relative group">
                        {/* Status Overlay */}
                        <div className="absolute top-4 right-4 px-3 py-1 bg-black/80 backdrop-blur-md rounded-full border border-white/10 text-[8px] font-black uppercase tracking-widest text-emerald-400 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                            Live Environment
                        </div>
                        <iframe
                            title="NazAI Live Preview"
                            srcDoc={result.website?.html}
                            className="w-full h-full border-none shadow-2xl"
                        />
                    </div>
                  ) : (
                    <div className="w-full h-full bg-[#050505] rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-[#0a0a0a]">
                        <div className="w-2 h-2 rounded-full bg-red-500/50" />
                        <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                        <div className="w-2 h-2 rounded-full bg-green-500/50" />
                        <span className="text-[9px] font-mono text-zinc-600 ml-4">index.html — Generated by NazAI</span>
                      </div>
                      <pre className="p-8 text-xs font-mono text-emerald-400/80 overflow-auto h-[calc(650px-40px)] scrollbar-hide">
                        <code>{result.website?.html}</code>
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default Generator;
