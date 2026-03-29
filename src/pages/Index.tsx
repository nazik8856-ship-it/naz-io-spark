import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden font-sans">
      {/* The Grid Background from your screenshot */}
      <div className="absolute inset-0 z-0 opacity-20" 
           style={{ backgroundImage: 'linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex justify-between items-center px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <div className="w-10 h-10 bg-blue-600 rounded flex items-center justify-center text-white font-black">N</div>
          NazAI
        </div>
        <div className="hidden md:flex items-center gap-8 text-zinc-400 font-medium">
          <a href="#" className="hover:text-white transition-colors">Features</a>
          <a href="#" className="hover:text-white transition-colors">How it Works</a>
          <a href="#" className="hover:text-white transition-colors">Feedback</a>
          <a href="#" className="hover:text-white transition-colors">Pricing</a>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/generate")} className="font-bold hover:text-zinc-300">Sign In</button>
          <Button onClick={() => navigate("/generate")} className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hidden sm:flex">Get Started</Button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center pt-32 px-6 text-center">
        {/* The Glowy Pill */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black border border-emerald-500/30 text-zinc-400 text-sm mb-12 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
          <Sparkles size={16} className="text-emerald-400" />
          <span>AI-Powered Business Launcher</span>
        </div>

        {/* The Big Bold Headline */}
        <h1 className="text-6xl md:text-8xl font-black tracking-tighter leading-[0.9] max-w-5xl mb-12">
          Launch a Real Online <br />
          Business using <span className="text-emerald-400">AI</span> <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">in</span> <br />
          <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Minutes</span>
        </h1>

        <p className="text-zinc-500 text-xl md:text-2xl max-w-3xl mx-auto leading-relaxed font-medium">
          Describe your idea. NazAI validates it, writes the plan, and deploys it live — in minutes.
        </p>

        <div className="mt-16">
          <Button 
            onClick={() => navigate("/generate")}
            size="lg"
            className="bg-white text-black hover:bg-zinc-200 h-16 px-10 text-xl font-bold rounded-2xl transition-transform active:scale-95"
          >
            Start Building Your Business
            <ArrowRight className="ml-2" size={24} />
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Index;
