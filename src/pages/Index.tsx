import { useNavigate } from "react-router-dom";
import { Zap, Shield, Rocket, ArrowRight, Sparkles, Cpu, ZapOff, Lock, BarChart3, Globe, Code2, MessageSquare, Twitter } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white selection:bg-emerald-500/30 font-sans">
      {/* Grid Background */}
      <div className="fixed inset-0 z-0 opacity-10" 
           style={{ backgroundImage: 'linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)', backgroundSize: '45px 45px' }}>
      </div>

      <nav className="relative z-10 flex justify-between items-center px-8 py-6 max-w-7xl mx-auto border-b border-white/5 bg-black/50 backdrop-blur-md">
        <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <div className="w-9 h-9 bg-blue-600 rounded flex items-center justify-center text-white font-black">N</div>
          Naz<span className="text-emerald-400">AI</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-zinc-400 font-medium text-sm">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a>
          <a href="#feedback" className="hover:text-white transition-colors">Feedback</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
        </div>
        <div className="flex items-center gap-6">
          <button onClick={() => navigate("/generate")} className="font-bold text-sm hover:text-zinc-300">Sign In</button>
          <Button onClick={() => navigate("/generate")} className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 px-6 h-10 rounded-lg text-sm font-bold">Get Started</Button>
        </div>
      </nav>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="pt-24 pb-20 px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/50 border border-emerald-500/20 text-zinc-400 text-xs mb-10">
            <Sparkles size={14} className="text-emerald-400" />
            <span>AI-Powered Business Launcher</span>
          </div>

          <h1 className="text-6xl md:text-[100px] font-black tracking-tighter leading-[0.85] mb-12 max-w-6xl mx-auto uppercase">
            Launch a Real Online Business using <span className="text-emerald-400 italic">AI</span> <span className="text-blue-400">in Minutes</span>
          </h1>

          <p className="text-zinc-500 text-lg md:text-xl max-w-3xl mx-auto mb-12 leading-relaxed">
            Describe your idea. NazAI validates it, writes the plan, and deploys it live — in minutes.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Button onClick={() => navigate("/generate")} className="bg-emerald-500 text-black hover:bg-emerald-400 h-14 px-10 text-lg font-bold rounded-full group">
              Start for Free <ArrowRight className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button variant="outline" className="border-white text-white bg-transparent h-14 px-10 text-lg font-bold rounded-full hover:bg-white hover:text-black transition-all">
              Watch Demo
            </Button>
          </div>

          <div className="space-y-4">
            <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-600 font-bold">Built for</p>
            <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-40 grayscale font-medium text-zinc-400">
              <span>Founders</span> <span>Solo Builders</span> <span>Startups</span> <span>Dev Teams</span> <span>Entrepreneurs</span>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 px-6 max-w-7xl mx-auto">
          <div className="text-center mb-20 space-y-4">
            <h2 className="text-5xl md:text-6xl font-black tracking-tighter">Powerful <span className="text-blue-400">Features</span></h2>
            <p className="text-zinc-500 max-w-2xl mx-auto">From idea to live product — NazAI handles validation, planning, building, and deployment.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeatureCard icon={<Cpu className="text-emerald-500" />} title="Advanced AI Models" desc="Access state-of-the-art language models trained on diverse datasets for superior performance." />
            <FeatureCard icon={<Zap className="text-emerald-500" />} title="Lightning Fast" desc="Experience sub-second response times with our optimized infrastructure and edge computing." />
            <FeatureCard icon={<Lock className="text-emerald-500" />} title="Enterprise Security" desc="Bank-grade encryption and compliance with SOC 2, GDPR, and HIPAA standards." />
            <FeatureCard icon={<BarChart3 className="text-emerald-500" />} title="Deep Analytics" desc="Gain actionable insights with comprehensive dashboards and custom reporting tools." />
            <FeatureCard icon={<Code2 className="text-emerald-500" />} title="Developer First" desc="Robust APIs, SDKs, and documentation designed for seamless integration." />
            <FeatureCard icon={<Globe className="text-emerald-500" />} title="Global Scale" desc="Deploy across 50+ regions with automatic scaling and 99.99% uptime guarantee." />
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-24 px-6 max-w-7xl mx-auto">
          <div className="text-center mb-20 space-y-4">
            <h2 className="text-5xl md:text-6xl font-black tracking-tighter">Simple, Transparent <span className="text-blue-400">Pricing</span></h2>
            <p className="text-zinc-500">Choose the perfect plan for your business needs. Always flexible.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <PriceCard price="$0" tier="Free" features={["1 Project", "AI idea validation", "Basic business plan", "Community support"]} btnText="Get Started" />
            <PriceCard price="$29" tier="Pro" features={["Unlimited projects", "Full business plan", "Landing page generation", "Custom domain support", "Email support"]} btnText="Start Free Trial" highlight />
            <PriceCard price="$99" tier="Business" features={["Everything in Pro", "Team collaboration", "Priority support", "API access", "Dedicated manager"]} btnText="Contact Sales" />
          </div>
        </section>

        {/* Testimonials */}
        <section className="py-24 bg-zinc-900/20 text-center px-6">
          <h2 className="text-4xl font-black mb-16 tracking-tighter">Trusted by <span className="text-emerald-400">Innovators</span></h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto text-left">
             <Testimonial text="NazAI helped me validate my business idea in minutes. The AI insights are incredibly accurate." author="Sarah Chen" role="Founder, TechStart" />
             <Testimonial text="The best business ideation tool I've used. It's like having a strategic advisor 24/7." author="Marcus Johnson" role="CEO, GrowthLabs" />
             <Testimonial text="From concept to execution plan in one session. NazAI is a game-changer for startups." author="Elena Rodriguez" role="Entrepreneur" />
          </div>
          <Button variant="outline" className="mt-20 border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-black h-12 rounded-xl px-8">
            <MessageSquare className="mr-2" size={18} /> Give Feedback
          </Button>
        </section>

        {/* Call to Action */}
        <section className="py-32 text-center px-6 border-t border-white/5">
          <h2 className="text-5xl md:text-6xl font-black tracking-tighter mb-4">Ready to Transform Your <span className="text-emerald-400">Workflow?</span></h2>
          <p className="text-zinc-500 mb-12">Join thousands of teams already using Naz.io to build the future.</p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button onClick={() => navigate("/generate")} className="bg-emerald-500 text-black hover:bg-emerald-400 h-16 px-10 text-xl font-bold rounded-2xl">Get Started Free →</Button>
            <Button variant="outline" className="border-zinc-800 text-white hover:bg-zinc-900 h-16 px-10 text-xl font-bold rounded-2xl">Contact Sales</Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-20 border-t border-white/5 max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-12">
          <div className="col-span-2 space-y-4">
            <div className="flex items-center gap-2 text-xl font-bold">
              <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-black">N</div>
              Naz<span className="text-emerald-400">AI</span>
            </div>
            <p className="text-zinc-500 text-sm max-w-[200px]">Building the future of AI-powered software.</p>
          </div>
          <FooterLinks title="Product" links={["Features", "Pricing", "Integrations", "Changelog"]} />
          <FooterLinks title="Company" links={["About", "Blog", "Careers", "Press"]} />
          <FooterLinks title="Resources" links={["Documentation", "API Reference", "Support"]} />
        </div>
        <div className="mt-20 flex flex-col md:flex-row justify-between items-center gap-8 text-zinc-500 text-sm">
          <p>© 2026 Naz.io. All rights reserved.</p>
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-full border border-zinc-800 flex items-center justify-center hover:text-white transition-colors cursor-pointer"><Twitter size={18} /></div>
            <div className="w-10 h-10 rounded-full border border-zinc-800 flex items-center justify-center hover:text-white transition-colors cursor-pointer"><span className="text-lg font-bold">Tik</span></div>
          </div>
        </div>
      </footer>
    </div>
  );
};

const FeatureCard = ({ icon, title, desc }: any) => (
  <div className="p-10 rounded-[32px] bg-zinc-900/30 border border-zinc-800/50 hover:bg-zinc-900/50 transition-all group">
    <div className="w-14 h-14 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">{icon}</div>
    <h3 className="text-2xl font-bold mb-4">{title}</h3>
    <p className="text-zinc-500 leading-relaxed">{desc}</p>
  </div>
);

const PriceCard = ({ price, tier, features, btnText, highlight }: any) => (
  <div className={`p-10 rounded-[40px] border ${highlight ? 'border-emerald-500/50 bg-zinc-900/20' : 'border-zinc-800 bg-black/50'} space-y-8 flex flex-col justify-between`}>
    <div>
      <h3 className="text-5xl font-black mb-2">{price}<span className="text-sm text-zinc-500 font-medium">/month</span></h3>
      <Button className={`w-full h-14 rounded-2xl text-lg font-bold mb-10 ${highlight ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-white text-black hover:bg-zinc-200'}`}>{btnText}</Button>
      <ul className="space-y-4">
        {features.map((f: string) => <li key={f} className="flex items-center gap-3 text-zinc-400 text-sm italic"><Zap size={14} className="text-emerald-500" fill="currentColor" /> {f}</li>)}
      </ul>
    </div>
  </div>
);

const Testimonial = ({ text, author, role }: any) => (
  <div className="space-y-6 p-8 rounded-3xl bg-zinc-900/10 border border-white/5">
    <div className="flex text-emerald-400 gap-1 text-xl">★★★★★</div>
    <p className="text-zinc-400 italic font-medium leading-relaxed">"{text}"</p>
    <div>
      <p className="font-bold text-lg">{author}</p>
      <p className="text-xs text-zinc-600 uppercase tracking-widest">{role}</p>
    </div>
  </div>
);

const FooterLinks = ({ title, links }: any) => (
  <div className="space-y-4">
    <h4 className="font-bold text-sm uppercase tracking-widest text-zinc-600">{title}</h4>
    <ul className="space-y-2 text-zinc-500 text-sm font-medium">
      {links.map((l: string) => <li key={l} className="hover:text-white transition-colors cursor-pointer">{l}</li>)}
    </ul>
  </div>
);

export default Index;
