import { useNavigate } from "react-router-dom";
import { Zap, Shield, Rocket, ArrowRight, Sparkles, Cpu, Lock, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white selection:bg-emerald-500/30 font-sans">
      {/* 48px Branding Grid */}
      <div
        className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#0ff 1px, transparent 1px), linear-gradient(90deg, #0ff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      ></div>

      {/* NAVBAR: SVG VERSION */}
      <nav className="relative z-50 flex justify-between items-center px-8 py-6 max-w-7xl mx-auto border-b border-white/5 bg-black/50 backdrop-blur-md sticky top-0">
        <div className="flex items-center gap-4 cursor-pointer" onClick={() => navigate("/")}>
          <div className="w-12 h-12 rounded-[14px] bg-black flex items-center justify-center border border-white/10 shadow-[0_0_20px_rgba(0,163,255,0.2)]">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="drop-shadow-[0_0_8px_rgba(0,163,255,0.8)]"
            >
              <path d="M7 19V5L17 19V5" stroke="#00A3FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="text-2xl font-black tracking-tighter uppercase italic leading-none text-white">
              Naz<span className="text-emerald-400">AI</span>
            </div>
            <span className="text-[8px] font-mono text-emerald-500/50 uppercase tracking-[0.4em] mt-1">
              Orchestrator v3
            </span>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-8 text-zinc-500 font-bold text-[10px] uppercase tracking-[0.2em]">
          <a href="#features" className="hover:text-emerald-400 transition-colors">
            Features
          </a>
          <a href="#pricing" className="hover:text-emerald-400 transition-colors">
            Pricing
          </a>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate("/generate")}
            className="font-bold text-xs uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
          >
            Sign In
          </button>
          <Button
            onClick={() => navigate("/generate")}
            className="bg-emerald-500 text-black hover:bg-emerald-400 px-6 h-10 rounded-lg text-xs font-black uppercase tracking-tighter shadow-[0_0_15px_rgba(16,185,129,0.3)]"
          >
            Get Started
          </Button>
        </div>
      </nav>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="pt-32 pb-20 px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/5 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest mb-10 animate-pulse">
            <Sparkles size={14} />
            <span>Neural Business Orchestrator v3</span>
          </div>

          <h1 className="text-6xl md:text-[120px] font-black tracking-tighter leading-[0.8] mb-12 max-w-6xl mx-auto uppercase italic">
            Build the <span className="text-emerald-400">Future</span> <br />
            <span className="text-white/20">with Agentic</span> <span className="text-cyan-400">AI</span>
          </h1>

          <p className="text-zinc-500 text-lg md:text-xl max-w-2xl mx-auto mb-12 font-medium leading-relaxed">
            The world's first autonomous business launcher. Describe your vision, and NazAI builds the brand, strategy,
            and code in 60 seconds.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-24">
            <div className="laser-border group transition-transform active:scale-95">
              <div className="laser-content">
                <Button
                  onClick={() => navigate("/generate")}
                  className="bg-emerald-500 text-black hover:bg-emerald-400 h-16 px-12 text-xl font-black rounded-xl"
                >
                  IGNITE PROJECT <ArrowRight className="ml-2 group-hover:translate-x-2 transition-transform" />
                </Button>
              </div>
            </div>
            <Button
              variant="outline"
              className="border-white/10 text-white bg-transparent h-16 px-10 text-xl font-bold rounded-2xl hover:bg-white/5 transition-all"
            >
              Watch System Demo
            </Button>
          </div>

          <div className="space-y-4">
            <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-700 font-black">
              Trusted by Solo-Builders at
            </p>
            <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-30 grayscale font-black text-zinc-500 italic uppercase text-[12px]">
              <span>Founders</span> <span>SaaS Teams</span> <span>Devs</span>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-32 px-6 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FeatureCard
              icon={<Cpu className="text-emerald-500" />}
              title="Neural Models"
              desc="Powered by Claude 3.5 Sonnet & GPT-4o for precise business logic and error-free code."
            />
            <FeatureCard
              icon={<Zap className="text-cyan-500" />}
              title="Laser Deployment"
              desc="Instant Vercel-ready previews. No more waiting for builds."
            />
            <FeatureCard
              icon={<Lock className="text-emerald-500" />}
              title="Vault Privacy"
              desc="Your ideas remain yours. All project data is encrypted and private."
            />
            <FeatureCard
              icon={<Code2 className="text-cyan-500" />}
              title="Clean Code"
              desc="Production-grade React & Tailwind code that you own and scale."
            />
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 px-6 max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-5xl md:text-7xl font-black tracking-tighter uppercase italic text-white">
              The <span className="text-emerald-400">Investment</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <PriceCard
              price="$0"
              tier="Explorer"
              features={["1 Active Project", "Basic Code Gen"]}
              btnText="Access System"
            />

            <div className="laser-border">
              <div className="laser-content">
                <PriceCard
                  price="$29"
                  tier="Founder"
                  features={["Unlimited Launches", "Advanced Live Preview", "Custom Domain Export"]}
                  btnText="Go Pro"
                  highlight
                />
              </div>
            </div>

            <PriceCard price="$99" tier="Scale" features={["Team Orchestration", "API Access"]} btnText="Contact Ops" />
          </div>
        </section>
      </main>

      {/* FOOTER: FIXED - NO BROKEN IMAGES HERE EITHER */}
      <footer className="relative z-10 px-8 py-20 border-t border-white/5 max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start gap-12">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-2xl font-black italic">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center border border-white/10 shadow-[0_0_10px_rgba(0,163,255,0.3)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M7 19V5L17 19V5"
                    stroke="#00A3FF"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              Naz<span className="text-emerald-400">AI</span>
            </div>
            <p className="text-zinc-600 text-[10px] uppercase font-bold tracking-widest max-w-[250px]">
              Building the future of autonomous entrepreneurship in Sumy, Ukraine.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

// Helper Components
const FeatureCard = ({ icon, title, desc }: any) => (
  <div className="glass p-12 rounded-[40px] hover:bg-white/[0.05] transition-all group border-white/5">
    <div className="w-16 h-16 rounded-2xl bg-black border border-white/10 flex items-center justify-center mb-8 group-hover:scale-110 group-hover:border-emerald-500/50 transition-all">
      {icon}
    </div>
    <h3 className="text-3xl font-black mb-4 uppercase tracking-tighter italic">{title}</h3>
    <p className="text-zinc-500 font-medium leading-relaxed">{desc}</p>
  </div>
);

const PriceCard = ({ price, tier, features, btnText, highlight }: any) => (
  <div
    className={`p-10 rounded-[38px] h-full space-y-8 flex flex-col justify-between ${highlight ? "bg-black" : "glass"}`}
  >
    <div>
      <p className="text-emerald-400 text-[10px] font-black uppercase tracking-[0.4em] mb-4">{tier}</p>
      <h3 className="text-6xl font-black mb-8 italic">
        {price}
        <span className="text-sm text-zinc-600 font-medium not-italic">/mo</span>
      </h3>
      <ul className="space-y-4 mb-10">
        {features.map((f: string) => (
          <li key={f} className="flex items-center gap-3 text-zinc-400 text-xs font-bold uppercase tracking-tight">
            <Zap size={14} className="text-emerald-500" fill="currentColor" /> {f}
          </li>
        ))}
      </ul>
    </div>
    <Button
      className={`w-full h-16 rounded-2xl text-lg font-black uppercase ${highlight ? "bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.2)]" : "bg-white/5 text-white hover:bg-white/10 border border-white/10"}`}
    >
      {btnText}
    </Button>
  </div>
);

export default Index;
