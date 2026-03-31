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
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');

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
    <div className="min-h-screen bg-background text-foreground selection:bg-accent/30 font-sans overflow-x-hidden">
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(hsl(var(--accent)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--accent)) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

      <main className="relative z-10 max-w-7xl mx-auto p-6 space-y-8">
        <header className="flex justify-between items-center py-4 border-b border-border">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => navigate("/")}>
            <div className="w-12 h-12 rounded-[14px] bg-background flex items-center justify-center border border-border shadow-[0_0_20px_rgba(0,163,255,0.2)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_0_8px_rgba(0,163,255,0.8)]">
                <path d="M7 19V5L17 19V5" stroke="#00A3FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-black tracking-tighter uppercase italic leading-none">
                Naz<span className="text-primary">AI</span>
              </h1>
              <span className="text-[8px] font-mono text-muted-foreground uppercase tracking-[0.3em] mt-1">
                Neural Interface v3.0
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground group">
              <RefreshCcw size={16} className="group-hover:rotate-180 transition-transform duration-500" />
            </Button>
            <Button onClick={() => navigate("/")} variant="outline" className="border-border text-[10px] font-black uppercase tracking-widest px-4 h-8 rounded-lg">
              <ArrowLeft size={12} className="mr-2" /> Exit
            </Button>
          </div>
        </header>

        <section className="space-y-4">
          <div className="laser-border">
            <div className="laser-content p-1">
              <div className="flex flex-col md:flex-row gap-4 bg-[#050505] p-4 rounded-xl">
                <div className="flex-1 flex gap-4">
                  <div className="mt-4 text-primary/50"><Terminal size={20} /></div>
                  <textarea
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="Describe your vision..."
                    className="flex-1 bg-transparent border-none text-foreground p-4 text-lg font-mono focus:ring-0 placeholder:text-muted-foreground/30 resize-none"
                    rows={3}
                  />
                </div>
                <div className="flex flex-col justify-end">
                  <Button 
                    onClick={handleGenerate}
                    disabled={loading || !idea}
                    className="h-full px-10 bg-primary text-primary-foreground hover:bg-primary/90 font-black rounded-xl transition-all active:scale-95 disabled:opacity-20 group"
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fade-in">
            <aside className="lg:col-span-4 space-y-6">
              <div className="glass p-8 rounded-[32px]">
                <div className="flex items-center gap-2 text-primary mb-6">
                  <Sparkles size={18} />
                  <h3 className="font-black uppercase tracking-widest text-xs italic">Brand Identity</h3>
                </div>
                <div className="space-y-6">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">Generated Name</p>
                    <p className="text-3xl font-black tracking-tighter italic">{result.brand?.name}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-2">Visual Logic</p>
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed italic border-l-2 border-primary/30 pl-4">
                      {result.brand?.logoPrompt}
                    </p>
                  </div>
                </div>
              </div>

              <div className="glass p-8 rounded-[32px]">
                <div className="flex items-center gap-2 text-accent mb-6">
                  <Rocket size={18} />
                  <h3 className="font-black uppercase tracking-widest text-xs italic">Growth Hooks</h3>
                </div>
                <ul className="space-y-4">
                  {result.strategy?.hooks?.map((hook: string, i: number) => (
                    <li key={i} className="text-[11px] text-muted-foreground font-bold uppercase tracking-tight flex gap-3 items-start">
                      <span className="text-accent font-mono mt-0.5">0{i+1}</span>
                      {hook}
                    </li>
                  ))}
                </ul>
              </div>

              <Button className="w-full h-12 rounded-xl bg-secondary border border-border text-[10px] font-black uppercase tracking-widest hover:bg-secondary/80">
                <Share2 size={14} className="mr-2" /> Share Project
              </Button>
            </aside>

            <div className="lg:col-span-8 space-y-4">
              <div className="flex justify-between items-center px-2">
                <div className="flex gap-4">
                  {['preview', 'code'].map((tab) => (
                    <button 
                      key={tab}
                      onClick={() => setActiveTab(tab as any)} 
                      className={`text-[10px] font-black uppercase tracking-[0.2em] transition-all pb-2 border-b-2 ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                  <Download size={14} />
                </Button>
              </div>

              <div className="laser-border h-[650px]">
                <div className="laser-content">
                  {activeTab === 'preview' ? (
                    <div className="w-full h-full bg-white rounded-xl overflow-hidden relative group">
                      <div className="absolute top-4 right-4 px-3 py-1 bg-black/80 backdrop-blur-md rounded-full border border-border text-[8px] font-black uppercase tracking-widest text-primary z-10 opacity-0 group-hover:opacity-100 transition-opacity">
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
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card">
                        <div className="w-2 h-2 rounded-full bg-red-500/50" />
                        <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                        <div className="w-2 h-2 rounded-full bg-green-500/50" />
                        <span className="text-[9px] font-mono text-muted-foreground ml-4">index.html — Generated by NazAI</span>
                      </div>
                      <pre className="p-8 text-xs font-mono text-primary/80 overflow-auto h-[calc(650px-40px)]">
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
