import { useNavigate } from "react-router-dom";
import { Zap, Shield, Rocket, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
      {/* Background Glow Effect */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[25%] -left-[10%] w-[50%] h-[50%] bg-cyan-500/10 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] -right-[10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />
      </div>

      <nav className="relative z-10 flex justify-between items-center p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
          <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center">
            <Zap size={18} className="text-black" fill="currentColor" />
          </div>
          NazAI
        </div>
        <Button 
          variant="ghost" 
          onClick={() => navigate("/generate")}
          className="text-zinc-400 hover:text-white hover:bg-zinc-900"
        >
          Get Started
        </Button>
      </nav>

      <main className="relative z-10 pt-20 pb-32 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-medium text-cyan-400">
            <Sparkles size={12} />
            <span>Now powered by Gemini 2.0 Flash</span>
          </div>
          
          <h1 className="text-6xl md:text-8xl font-bold tracking-tight leading-[1.1]">
            Build the web <br /> 
            <span className="bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent">
              at the speed of thought.
            </span>
          </h1>
          
          <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            Stop coding from scratch. Describe your vision and let NazAI generate 
            production-ready landing pages in seconds.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button 
              size="lg" 
              onClick={() => navigate("/generate")}
              className="bg-white text-black hover:bg-zinc-200 h-14 px-8 text-lg font-bold rounded-2xl w-full sm:w-auto transition-transform active:scale-95"
            >
              Start Generating Free
              <ArrowRight className="ml-2" size={20} />
            </Button>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="max-w-7xl mx-auto mt-40 grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeatureCard 
            icon={<Zap className="text-cyan-400" />}
            title="Instant Preview"
            desc="See your changes in real-time with our built-in high-performance iframe renderer."
          />
          <FeatureCard 
            icon={<Shield className="text-purple-400" />}
            title="Clean Code"
            desc="No bloat. Just pure Tailwind CSS and HTML that you can download and host anywhere."
          />
          <FeatureCard 
            icon={<Rocket className="text-blue-400" />}
            title="SEO Optimized"
            desc="Every site is built with modern web standards to rank higher on search engines."
          />
        </div>
      </main>
    </div>
  );
};

const FeatureCard = ({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) => (
  <div className="p-8 rounded-3xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-colors group">
    <div className="w-12 h-12 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-3">{title}</h3>
    <p className="text-zinc-400 leading-relaxed">{desc}</p>
  </div>
);

export default Index;
