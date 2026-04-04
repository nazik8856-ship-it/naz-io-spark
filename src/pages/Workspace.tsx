import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Home, Clock, Archive, Trash2, Cpu, Plus, Zap, Shield, ChevronRight, FileUp } from "lucide-react";

// Define the type for a Mission to keep code "accurate"
interface Mission {
  id: string;
  name: string;
  timestamp: string;
  status: "active" | "archived" | "trash";
  content: string;
}

const Workspace = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- STATE MANAGEMENT ---
  const [input, setInput] = useState("");
  const [activeDirective, setActiveDirective] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSolution, setLastSolution] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<"home" | "recents" | "archives" | "trash">("home");

  // Load missions from localStorage
  const [missions, setMissions] = useState<Mission[]>(() => {
    const saved = localStorage.getItem("nazai_missions");
    return saved ? JSON.parse(saved) : [];
  });

  const [history, setHistory] = useState([
    { text: "NODE_INIT // PARALLEL_EXECUTION_START", type: "system" },
    { text: "DECRYPTION_SEQUENCE // INITIATED", type: "system" },
  ]);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem("nazai_missions", JSON.stringify(missions));
  }, [missions]);

  // Auth Protection
  useEffect(() => {
    if (!loading && !user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  // --- LOGIC HANDLERS ---
  const addLog = (text: string, type: "system" | "user" | "success") => {
    setHistory((prev) => [...prev, { text, type }]);
  };

  const handleDirectiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const currentInput = input;
    setActiveDirective(currentInput);
    setInput("");
    setIsProcessing(true);
    setLastSolution(null);
    setCurrentView("home"); // Switch back to terminal view

    setTimeout(() => addLog(`DIRECTIVE: ${currentInput}`, "user"), 500);
    setTimeout(() => {
      setLastSolution(`Objective: ${currentInput}. Neural nodes synchronized and architecture drafted.`);
      setIsProcessing(false);
      addLog("SUCCESS // SOLUTION_READY", "success");
    }, 2000);
  };

  const saveMission = () => {
    const newMission: Mission = {
      id: `SYS-${Math.floor(Math.random() * 9000) + 1000}`,
      name: activeDirective || "Untitled Mission",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "archived",
      content: lastSolution || "",
    };

    setMissions((prev) => [newMission, ...prev]);
    setLastSolution(null);
    setActiveDirective("");
    addLog(`MISSION_${newMission.id}_SAVED`, "success");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      addLog(`IMPORTING: ${file.name.toUpperCase()}`, "system");
      setTimeout(() => addLog("EXTERNAL_DATA_SYNCED", "success"), 1000);
    }
  };

  // Filter missions for the sidebar list
  const filteredMissions = missions.filter((m) => {
    if (currentView === "archives") return m.status === "archived";
    if (currentView === "trash") return m.status === "trash";
    return true; // Default/Recents view
  });

  if (loading || !user) return null;

  return (
    <div className="fixed inset-0 flex bg-[#020617] text-white font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* SIDEBAR */}
      <aside className="w-64 bg-[#0a0f1d]/50 backdrop-blur-xl border-r border-white/5 flex flex-col p-6">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 rounded-lg bg-[#00A3FF]/10 flex items-center justify-center border border-[#00A3FF]/30 shadow-[0_0_15px_rgba(0,163,255,0.2)]">
            <Cpu size={18} className="text-[#00A3FF]" />
          </div>
          <span className="font-bold tracking-tight uppercase text-xs tracking-[0.2em]">NazAI // OS</span>
        </div>

        <nav className="space-y-2 mb-8">
          <NavItem
            icon={<Home size={18} />}
            label="Home"
            active={currentView === "home"}
            onClick={() => setCurrentView("home")}
          />
          <NavItem
            icon={<Clock size={18} />}
            label="Recents"
            active={currentView === "recents"}
            onClick={() => setCurrentView("recents")}
          />
          <NavItem
            icon={<Archive size={18} />}
            label="Archives"
            active={currentView === "archives"}
            onClick={() => setCurrentView("archives")}
          />
          <NavItem
            icon={<Trash2 size={18} />}
            label="Trash"
            active={currentView === "trash"}
            onClick={() => setCurrentView("trash")}
          />
        </nav>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-hide">
          <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold px-2">Live Assets</p>
          {filteredMissions.map((m) => (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              key={m.id}
              className="group p-3 rounded-xl hover:bg-white/5 cursor-pointer border border-transparent hover:border-white/5 transition-all"
            >
              <p className="text-xs font-medium text-white/70 group-hover:text-[#00A3FF] truncate">{m.name}</p>
              <div className="flex justify-between items-center mt-1">
                <span className="text-[8px] text-white/20 uppercase">{m.id}</span>
                <span className="text-[8px] text-[#00ff80]/40 tabular-nums">{m.timestamp}</span>
              </div>
            </motion.div>
          ))}
          {filteredMissions.length === 0 && (
            <p className="text-[9px] text-white/10 px-2 italic">No assets detected in {currentView}...</p>
          )}
        </div>

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
            <ChevronRight size={14} /> NAZAI:// <span className="text-white uppercase">{currentView}</span>
          </div>
        </header>

        {/* LOG STREAM */}
        <div className="p-8 space-y-2 font-mono text-[11px] overflow-y-auto max-h-[300px] scrollbar-hide">
          {history.slice(-10).map((log, i) => (
            <div
              key={i}
              className={`${log.type === "user" ? "text-[#00A3FF]" : log.type === "success" ? "text-[#00ff80]" : "text-[#00ff80]/60"} uppercase tracking-wider`}
            >
              {`> ${log.text}`}
            </div>
          ))}
          {isProcessing && (
            <div className="text-[#00A3FF] animate-pulse uppercase tracking-wider">{`> SYNCHRONIZING_NEURAL_NODES...`}</div>
          )}
        </div>

        {/* THE SOLUTION BOX */}
        <div className="flex-1 px-12 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            {lastSolution && currentView === "home" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-3xl bg-[#0d1526]/50 border border-[#00A3FF]/20 rounded-3xl p-10 backdrop-blur-md shadow-[0_0_50px_rgba(0,163,255,0.1)] relative"
              >
                <div className="flex justify-between items-start mb-8">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-6 bg-[#00ff80] shadow-[0_0_8px_#00ff80]" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#00ff80]">
                      Solution_Extracted
                    </span>
                  </div>
                  <button
                    onClick={saveMission}
                    className="flex items-center gap-2 px-4 py-2 bg-[#00A3FF]/10 border border-[#00A3FF]/40 rounded-lg text-[#00A3FF] text-[10px] font-black uppercase tracking-widest hover:bg-[#00A3FF] hover:text-white transition-all shadow-[0_0_20px_rgba(0,163,255,0.1)]"
                  >
                    <Archive size={14} /> Save Mission
                  </button>
                </div>
                <h2 className="text-3xl font-medium mb-8 text-white/90 tracking-tight">Project: {activeDirective}</h2>
                <div className="bg-black/40 border border-white/5 rounded-2xl p-6 relative group overflow-hidden">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-30 transition-opacity">
                    <Zap size={40} className="text-[#00A3FF]" />
                  </div>
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
            <div className="bg-[#0d1526]/80 border border-white/10 p-4 rounded-2xl flex items-center gap-4 focus-within:border-[#00A3FF]/50 transition-all shadow-2xl backdrop-blur-md group">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors"
              >
                <Plus
                  className={isProcessing ? "animate-spin text-[#00A3FF]" : "text-white/20 group-hover:text-[#00A3FF]"}
                />
              </button>
              <input
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/10 text-lg"
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

// Sidebar Navigation Item
const NavItem = ({ icon, label, active, onClick }: any) => (
  <div
    onClick={onClick}
    className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all ${active ? "bg-[#00A3FF]/10 text-[#00A3FF] shadow-[inset_0_0_10px_rgba(0,163,255,0.05)]" : "text-white/40 hover:text-white hover:bg-white/5"}`}
  >
    {icon}
    <span className="text-sm font-medium">{label}</span>
    {active && (
      <motion.div layoutId="activeNav" className="ml-auto w-1 h-1 rounded-full bg-[#00A3FF] shadow-[0_0_8px_#00A3FF]" />
    )}
  </div>
);

export default Workspace;
