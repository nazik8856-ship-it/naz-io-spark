import { useNavigate } from "react-router-dom";
import { Zap, Shield, Rocket, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white">
      <nav className="flex justify-between items-center p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
          <Zap size={20} className="text-cyan-400" fill="currentColor" />
          NazAI
        </div>
        <Button 
          variant="ghost" 
          onClick={() => navigate("/generate")}
          className="text-zinc-400 hover:text-white"
        >
          Sign In
        </Button>
      </nav>

      <main className="pt-20 pb-32 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h1 className="text-6xl md:text-7xl font-bold tracking-tight">
            Launch your AI business <br /> 
            <span className="text-cyan-400 font-mono">in seconds.</span>
          </h1>
          
          <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto">
            The ultimate AI website generator for modern entrepreneurs. 
            Build, preview, and deploy without touching code.
          </p>

          <div className="flex justify-center pt-4">
            <Button 
              size="lg" 
              onClick={() => navigate("/generate")}
              className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold h-14 px-8 text-lg rounded-xl transition-all hover:scale-105"
            >
              Get Started Now
              <ArrowRight className="ml-2" size={20} />
            </Button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-32 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800">
            <Zap className="text-cyan-400 mb-4" />
            <h3 className="text-xl font-bold mb-2">Lightning Fast</h3>
            <p className="text-zinc-400">Generate high-quality landing pages faster than you can write a prompt.</p>
          </div>
          <div className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800">
            <Shield className="text-cyan-400 mb-4" />
            <h3 className="text-xl font-bold mb-2">Secure & Private</h3>
            <p className="text-zinc-400">Your data and generated code are protected with enterprise-grade security.</p>
          </div>
          <div className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800">
            <Rocket className="text-cyan-400 mb-4" />
            <h3 className="text-xl font-bold mb-2">Ready to Launch</h3>
            <p className="text-zinc-400">Download your code and host it anywhere instantly.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
