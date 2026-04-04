import React from "react";
import { useNavigate } from "react-router-dom";
import { 
  Zap, ArrowRight, Sparkles, Cpu, 
  Lock, BarChart3, Globe, Code2, 
  MessageSquare, Twitter 
} from "lucide-react";
import { Button } from "@/components/ui/button";

// --- Sub-Components (Cleaned up for single-file use) ---

const FeatureCard = ({ icon, title, desc }: any) => (
  <div className="p-10 rounded-[32px] bg-zinc-900/30 border border-zinc-800/50 hover:bg-zinc-900/50 transition-all group">
    <div className="w-14 h-14 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">{icon}</div>
    <h3 className="text-2xl font-bold mb-4 text-white">{title}</h3>
    <p className="text-zinc-500 leading-relaxed text-sm font-mono">{desc}</p>
  </div>
);

const PriceCard = ({ price, tier, features, btnText, highlight, onClick }: any) => (
  <div className={`p-10 rounded-[40px] border flex flex-col justify-between transition-all ${highlight ? 'border-emerald-500/50 bg-zinc-900/20 shadow-[0_0_30px_rgba(16,185,129,0.05)]' : 'border-zinc-800 bg-black/50'}`}>
    <div>
      <div className="text-[10px] font-mono text-emerald-400 uppercase tracking-[0.3em] mb-4">{tier}</div>
      <h3 className="text-5xl font-black mb-6 text-white">{price}<span className="text-sm text-zinc-500 font-medium">/mo</span></h3>
      <ul className="space-y-4 mb-10">
        {features.map((f: string) => (
          <li key={f} className="flex items-center gap-3 text-zinc-400 text-xs italic font-mono">
            <Zap size={12} className="text-emerald-500" fill="currentColor" /> {f}
          </li>
        ))}
      </ul>
    </div>
    <Button 
      onClick={onClick}
      className={`w-full h-14 rounded-2xl text-lg font-bold ${highlight ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-zinc-900 text-white border border-zinc-800 hover:bg-zinc-800'}`}
    >
      {btnText}
    </Button>
  </div>
);

// --- Main Page ---

const Index = () => {
  const navigate = useNavigate();
  const handleStart = () => navigate("/generate");

  return (
    <div className="min-h-screen bg-black text-white selection:bg-emerald-500/30 font-sans overflow-x-hidden">
      {/* 48px Grid Background - Consistent with NazAI Branding */}
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#0ff 1px, transparent 1px), linear-gradient(90deg, #0ff 1px, transparent 1px)', backgroundSize: '48px 48px' }}>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex justify-between items-center px-8 py-6 max-w-7xl mx-auto border-b border-white/5 bg-black/50 backdrop-blur-md">
        <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <div className="w-9 h-9 bg-emerald-500 rounded flex items-center justify-center text-black font-black">N</div>
          Naz<span className="text-emerald-400">AI</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-zinc-500 font-mono text-[10px] uppercase tracking-widest">
          <a href="#features" className="hover:text-emerald-400 transition-colors">Features</a>
          <a href="#pricing" className="hover:text-emerald-400 transition-colors">Pricing</a>
        </div>
        <div className="flex items-center gap-4">
          <Button onClick={handleStart} variant="ghost" className="text-zinc-400 hover:text-white">Sign In</Button>
          <Button onClick={handleStart} className="bg-emerald-500 text-black hover:bg-emerald-400 px-6 rounded-lg font-bold">Launch</Button>
        </div>
      </nav>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="pt-32 pb-20 px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/5 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono uppercase tracking-widest mb-10">
            <Sparkles size={14} />
            <span>AI-Powered Venture Studio</span>
          </div>

          <h1 className="text-6xl md:text-[110px] font-black tracking-tighter leading-[0.85] mb-12 max-w-5xl mx-auto uppercase">
            Deploy your <span className="text-emerald-400">Empire</span> <br />
            <span className="text-zinc-800">in 60 Seconds</span>
          </h1>

          <p className="text-zinc-500 text-lg max-w-2xl mx-auto mb-12 font-mono leading-relaxed">
            Describe the vision. Our AI Squad builds the brand, the code, and the strategy. Live on Vercel instantly.
          </p>

          <div className="flex flex-col sm:row items-center justify-center gap-4 mb-24">
            <Button onClick={handleStart} className="bg-emerald-500 text-black hover:bg-emerald-400 h-16 px-12 text-xl font-black rounded-full group transition-all hover:scale-105">
              START GENERATING <ArrowRight className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="py-24 px-6 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard icon={<Cpu size={24} className="text-emerald-400" />} title="Sonnet 4.5 Engine" desc="Powered by the most advanced perspective-driven AI models on the market." />
            <FeatureCard icon={<Code2 size={24} className="text-emerald-400" />} title="Automatic Deploy" desc="One click from prompt to live production URL via Vercel integration." />
            <FeatureCard icon={<BarChart3 size={24} className="text-emerald-400" />} title="Growth Strategy" desc="Automated marketing hooks, tweet threads, and launch channels." />
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 px-6 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <PriceCard 
              price="$0" 
              tier="Builder" 
              features={["3 Projects / mo", "Standard Workflow", "Community support"]} 
              btnText="Start Building"
              onClick={handleStart}
            />
            <PriceCard 
              price="$29" 
              tier="Founder" 
              features={["Unlimited Launches", "Claude 4.5 Orchestrator", "Priority Vercel Deploy", "Advanced Marketing Suite"]} 
              btnText="Go Unlimited" 
              highlight 
              onClick={handleStart}
            />
          </div>
        </section>
      </main>

      <footer className="py-20 border-t border-white/5 text-center">
        <p className="text-zinc-600 font-mono text-[10px] uppercase tracking-widest">© 2026 NazAI — Built for the 1%</p>
      </footer>
    </div>
  );
};

export default Index;
