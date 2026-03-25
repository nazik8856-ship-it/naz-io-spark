import React from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import Feedback from "@/components/Feedback";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

const BusinessTypeCards = ({ onSelectionChange }: { onSelectionChange: (val: string) => void }) => {
  const [selected, setSelected] = React.useState("");
  const [custom, setCustom] = React.useState("");
  const [isCustom, setIsCustom] = React.useState(false);

  React.useEffect(() => {
    onSelectionChange(isCustom ? custom : selected);
  }, [selected, custom, isCustom, onSelectionChange]);

  const options = [
    { id: 'ecom', title: "E-Commerce", icon: "🛍️" },
    { id: 'saas', title: "SaaS", icon: "⚙️" },
    { id: 'port', title: "Portfolio", icon: "🎨" },
  ];

  return (
    <div className="space-y-4 my-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => { setSelected(opt.title); setIsCustom(false); }}
            className={`p-4 rounded-xl border-2 transition-all ${selected === opt.title && !isCustom ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-800 bg-slate-900'}`}
          >
            <span className="text-2xl mb-1 block">{opt.icon}</span>
            <span className="text-sm font-bold text-white">{opt.title}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setIsCustom(true); setSelected(""); }}
          className={`p-4 rounded-xl border-2 transition-all ${isCustom ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-800 bg-slate-900'}`}
        >
          <span className="text-2xl mb-1 block">✨</span>
          <span className="text-sm font-bold text-white">Other</span>
        </button>
      </div>
      {isCustom && (
        <input
          type="text"
          placeholder="What kind of business? (e.g. AI Gym, Pet Shop...)"
          className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-white outline-none focus:border-cyan-500"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      )}
    </div>
  );
};

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <Hero />
      <div className="container mx-auto py-10">
        <h2 className="text-3xl font-bold text-center mb-8">Choose your business type</h2>
        <BusinessTypeCards onSelectionChange={(val) => console.log(val)} />
      </div>
      <Features />
      <HowItWorks />
      <Feedback />
      <CTA />
      <Footer />
    </div>
  );
};

export default Index;
