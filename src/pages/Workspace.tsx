import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Home, Clock, Archive, Trash2, Cpu, Plus, Zap, Shield, ChevronRight, Check } from "lucide-react";

const Workspace = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [activeDirective, setActiveDirective] = useState(""); // Stores the prompt for the card title
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSolution, setLastSolution] = useState<string | null>(null);
  const [history, setHistory] = useState([
    { text: "NODE_INIT // PARALLEL_EXECUTION_START", type: "system" },
    { text: "DECRYPTION_SEQUENCE // INITIATED", type: "system" },
  ]);

  // Auth Protection
  useEffect(() => {
    if (!loading && !user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  const handleDirectiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const currentInput = input;
    setActiveDirective(currentInput);
    setInput("");
    setIsProcessing(true);
    setLastSolution(null);

    // Simulated Logic Flow
    setTimeout(() => setHistory((prev) => [...prev, { text: `> DIRECTIVE: ${currentInput}`, type: "user" }]), 500);
    setTimeout(() => {
      setLastSolution(`Objective: ${currentInput}. Neural nodes synchronized and architecture drafted.`);
      setIsProcessing(false);
    }, 2000);
  };

  const saveMission = () => {
    setHistory((prev) => [...prev, { text: "SUCCESS // MISSION_SAVED_TO_ARCHIVES", type: "system" }]);
    setLastSolution(null);
    setActiveDirective("");
  };

  if (loading || !user) return null;

  return (
    <div className="fixed inset-0 flex bg-[#020617] text-white font-sans overflow-hidden">
      {/* SIDEBAR: BLUE-NEON STYLE */}
      <aside className="w-64 bg-[#0a0f1d]/50 backdrop-blur-xl border-r border-white/5 flex flex-col p-6">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 rounded-lg bg-[#00A3FF]/10 flex items-center justify-center border border-[#00A3FF]/30">
            <Cpu size={18} className="text-[#00A3FF]" />
          </div>
          <span className="font-bold tracking-tight uppercase text-xs tracking-[0.2em]">NazAI // OS</span>
        </div>

        <nav className="space-y-2 flex-1">
          <NavItem icon={<Home size={18} />} label="Home" active />
          <NavItem icon={<Clock size={18} />} label="Recents" />
          <NavItem icon={<Archive size={18} />} label="Archives" />
          <NavItem icon={<Trash2 size={18} />} label="Trash" />
        </nav>

        <div className="pt-6 border-t border-white/5">
          <div className="flex items-center gap-2 text-[10px] text-white/20 uppercase tracking-[0.2em]">
            <Shield size={12} /> Secure_Node // Active
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col relative bg-[radial-gradient(circle_at_top_right,_#00A3FF05,_transparent_40%)]">
        <header className="h-16 flex items-center px-8 border-b border-white/5">
          <div className="flex items-center gap-2 text-[10px] font-mono text-[#00A3FF]">
            <ChevronRight size={14} /> NAZAI:// <span className="text-white">WORKSPACE</span>
          </div>
        </header>

        {/* LOG STREAM */}
        <div className="p-8 space-y-2 font-mono text-[11px]">
          {history.map((log, i) => (
            <div
              key={i}
              className={`${log.type === "user" ? "text-[#00A3FF]" : "text-[#00ff80]"} opacity-80 uppercase tracking-wider`}
            >
              {`> ${log.text}`}
            </div>
          ))}
          {isProcessing && (
            <div className="text-[#00A3FF] animate-pulse uppercase tracking-wider">{`> PROCESSING_DATA_STREAMS...`}</div>
          )}
        </div>

        {/* THE SOLUTION BOX */}
        <div className="flex-1 px-12 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            {lastSolution && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-3xl bg-[#0d1526]/50 border border-[#00A3FF]/20 rounded-3xl p-10 backdrop-blur-md shadow-[0_0_50px_rgba(0,163,255,0.1)] relative"
              >
                <div className="flex justify-between items-start mb-8">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-6 bg-[#00ff80]" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#00ff80]">
                      Solution_Extracted
                    </span>
                  </div>

                  {/* THE SAVE BUTTON */}
                  <button
                    onClick={saveMission}
                    className="flex items-center gap-2 px-4 py-2 bg-[#00A3FF]/10 border border-[#00A3FF]/40 rounded-lg text-[#00A3FF] text-[10px] font-black uppercase tracking-widest hover:bg-[#00A3FF] hover:text-white transition-all"
                  >
                    <Archive size={14} />
                    Save Mission
                  </button>
                </div>

                <h2 className="text-3xl font-medium mb-8 text-white/90">
                  {activeDirective ? `Project: ${activeDirective}` : "Analysis Complete"}
                </h2>

                <div className="bg-black/40 border border-white/5 rounded-2xl p-6 relative">
                  <p className="text-[10px] text-white/30 uppercase font-bold mb-3 tracking-widest flex items-center gap-2">
                    <Zap size={12} className="text-[#00A3FF]" /> Analysis & Reasoning
                  </p>
                  <p className="text-white/70 leading-relaxed italic font-light">{lastSolution}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* FLOATING INPUT BAR */}
        <div className="p-12">
          <form onSubmit={handleDirectiveSubmit} className="max-w-4xl mx-auto">
            <div className="bg-[#0d1526]/80 border border-white/10 p-4 rounded-2xl flex items-center gap-4 focus-within:border-[#00A3FF]/50 transition-all shadow-2xl backdrop-blur-md">
              <Plus className={isProcessing ? "animate-spin text-[#00A3FF]" : "text-white/20"} />
              <input
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/10"
                placeholder={isProcessing ? "Neural nodes working..." : "Awaiting directive..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isProcessing}
              />
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

const NavItem = ({ icon, label, active }: any) => (
  <div
    className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all ${active ? "bg-[#00A3FF]/10 text-[#00A3FF]" : "text-white/40 hover:text-white hover:bg-white/5"}`}
  >
    {icon}
    <span className="text-sm font-medium">{label}</span>
    {active && <div className="ml-auto w-1 h-1 rounded-full bg-[#00A3FF]" />}
  </div>
);

export default Workspace;
