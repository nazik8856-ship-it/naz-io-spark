import { useNavigate } from "react-router-dom";
import { Zap, Shield, Rocket, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      {/* Manus Style: Minimalist & High-Impact */}
      <div className="max-w-4xl w-full text-center space-y-12">
        <div className="space-y-4">
          <div className="flex justify-center mb-6">
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl">
              <Zap size={40} className="text-cyan-400" fill="currentColor" />
            </div>
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter">
            NazAI <span className="text-cyan-400">Launcher</span>
          </h1>
          <p className="text-zinc-500 text-lg md:text-xl max-w-2xl mx-auto">
            The autonomous AI agent for building and launching 
            software businesses in record time.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button 
            size="lg" 
            onClick={() => navigate("/generate")}
            className="bg-white text-black hover:bg-zinc-200 h-14 px-10 text-lg font-bold rounded-full transition-all hover:scale-105"
          >
            Start Building
            <ArrowRight className="ml-2" size={20} />
          </Button>
          <Button 
            variant="outline"
            size="lg"
            className="border-zinc-800 text-zinc-400 hover:text-white h-14 px-10 rounded-full"
          >
            Documentation
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-12">
          <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
            <p className="text-xs font-mono text-cyan-500 mb-2">01. PROMPT</p>
            <h3 className="font-bold">Describe Idea</h3>
          </div>
          <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
            <p className="text-xs font-mono text-cyan-500 mb-2">02. GENERATE</p>
            <h3 className="font-bold">AI Codes Site</h3>
          </div>
          <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
            <p className="text-xs font-mono text-cyan-500 mb-2">03. LAUNCH</p>
            <h3 className="font-bold">Go Live Instantly</h3>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
