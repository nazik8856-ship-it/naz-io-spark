import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Home, Clock, Archive, Cpu, Plus, Terminal, Zap, Shield } from "lucide-react";

const Workspace = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // --- EXISTING AUTH & DIRECTIVE LOGIC ---
  const [directive] = useState(() => {
    const saved = sessionStorage.getItem("nazai_directive");
    sessionStorage.removeItem("nazai_directive");
    return saved || "";
  });
  const [hydrating, setHydrating] = useState(true);

  // --- NEURAL BRIDGE STATE ---
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSolution, setLastSolution] = useState<string | null>(null);
  const [missions, setMissions] = useState([{ id: "SYS-01", name: "IDEATION_NODE", status: "completed" }]);
  const [history, setHistory] = useState([
    { time: "09:41:12", text: "NAZAI_OS_V3_READY", type: "system" },
    { time: "09:41:12", text: "SYSTEM_CHECK: ENCRYPTION_ACTIVE", type: "success" },
  ]);

  useEffect(() => {
    if (!loading && !user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => setHydrating(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [user]);

  // --- THE NEURAL BRIDGE LOGIC ---
  const addLog = (text: string, type: "system" | "success" | "user" | "warning") => {
    setHistory((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString([], { hour12: false }),
        text,
        type,
      },
    ]);
  };

  const handleDirectiveSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const currentInput = input;
    setInput("");
    setIsProcessing(true);
    setLastSolution(null);

    // Sequence 1: User Input
    addLog(`> DIRECTIVE: ${currentInput}`, "user");

    // Sequence 2: Simulation
    setTimeout(() => addLog("INITIATING_NEURAL_ORCHESTRATION...", "system"), 600);
    setTimeout(() => addLog("ACCESSING_KNOWLEDGE_BASE...", "system"), 1200);
    setTimeout(() => addLog("NODE_COMPILATION_COMPLETE", "warning"), 2000);

    // Sequence 3: Solution Delivery
    setTimeout(() => {
      addLog("SUCCESS // SOLUTION_LOCKED", "success");
      setLastSolution(`Project "${currentInput.toUpperCase()}" architecture synthesized. Ready for deployment.`);
      setIsProcessing(false);
    }, 2800);
  };

  const saveToArchives = () => {
    if (!lastSolution) return;
    const newId = `SYS-0${missions.length + 1}`;
    setMissions((prev) => [{ id: newId, name: lastSolution.substring(9, 25), status: "archived" }, ...prev]);
    setLastSolution(null);
    addLog(`DATA_BLOCK [${newId}] COMMITTED TO ARCHIVES.`, "success");
  };

  if (loading || !user) return null;

  // --- RESTORED HYDRATION UI ---
  if (hydrating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-6 text-center"
        >
          <div className="w-12 h-12 border-2 border-[#00ff80]/30 border-t-[#00ff80] rounded-full animate-spin" />
          <h2 className="text-lg font-mono text-[#00ff80] uppercase tracking-widest">
            {directive ? "Orchestrating Solution..." : "Initializing NazAI OS..."}
          </h2>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex bg-[#020606] text-[#00ff80] font-mono overflow-hidden selection:bg-[#00ff80]/20">
      {/* SIDEBAR: ASSET MANAGEMENT */}
      <aside className="w-72 bg-[#050808] border-r border-[#00ff80]/10 flex flex-col">
        <div className="p-6 border-b border-[#00ff80]/10 flex items-center gap-3">
          <div className="p-2 bg-[#00ff80]/10 rounded border border-[#00ff80]/20">
            <Cpu size={20} />
          </div>
          <span className="text-sm font-black tracking-tighter text-white">NAZAI://OS</span>
        </div>

        <div className="flex-1 p-4 space-y-6 overflow-y-auto">
          <div>
            <p className="text-[10px] text-[#00ff80]/30 font-bold uppercase mb-4 tracking-widest px-2">Navigation</p>
            <div className="space-y-1">
              <button className="w-full flex items-center gap-3 p-3 rounded-lg bg-[#00ff80]/5 text-white text-xs border border-[#00ff80]/20">
                <Home size={16} /> HOME
              </button>
              <button className="w-full flex items-center gap-3 p-3 rounded-lg text-[#00ff80]/40 hover:bg-white/5 text-xs">
                <Clock size={16} /> RECENTS
              </button>
              <button className="w-full flex items-center gap-3 p-3 rounded-lg text-[#00ff80]/40 hover:bg-white/5 text-xs">
                <Archive size={16} /> ARCHIVES [{missions.length}]
              </button>
            </div>
          </div>

          <div>
            <p className="text-[10px] text-[#00ff80]/30 font-bold uppercase mb-4 tracking-widest px-2">Live Assets</p>
            <div className="space-y-3 px-2">
              {missions.map((m) => (
                <div
                  key={m.id}
                  className="border-l border-[#00ff80]/10 pl-4 py-1 hover:border-[#00ff80] transition-colors cursor-pointer"
                >
                  <p className="text-[10px] font-bold text-white/80">{m.name}</p>
                  <p className="text-[8px] text-[#00ff80]/40 tracking-tighter">{m.id} // SECURE_STORAGE</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN TERMINAL */}
      <main className="flex-1 flex flex-col relative bg-black">
        <header className="h-16 border-b border-[#00ff80]/10 flex items-center px-8 justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold text-[#00ff80]/60">
            <Terminal size={14} className="text-blue-500" />
            DIRECTORY: <span className="text-white">ROOT/WORKSPACE</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-[10px] text-emerald-500">
              <Shield size={12} /> ENCRYPTED
            </div>
          </div>
        </header>

        {/* LOG STREAM */}
        <div className="flex-1 p-8 overflow-y-auto space-y-2 scrollbar-hide">
          {history.map((log, i) => (
            <div
              key={i}
              className={`text-xs flex gap-4 ${log.type === "user" ? "bg-[#00ff80]/5 p-2 rounded border border-[#00ff80]/10" : ""}`}
            >
              <span className="opacity-20 tabular-nums">[{log.time}]</span>
              <span
                className={
                  log.type === "success"
                    ? "text-[#00ff80]"
                    : log.type === "warning"
                      ? "text-yellow-500"
                      : "text-[#00ff80]/70"
                }
              >
                {log.text}
              </span>
            </div>
          ))}

          <AnimatePresence>
            {lastSolution && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="mt-8 p-6 bg-[#00ff80]/5 border border-[#00ff80]/20 rounded-xl flex justify-between items-center"
              >
                <div>
                  <p className="text-[10px] font-black uppercase text-[#00ff80] mb-2 tracking-[0.2em]">
                    Solution Extracted
                  </p>
                  <p className="text-lg text-white font-medium">{lastSolution}</p>
                </div>
                <button
                  onClick={saveToArchives}
                  className="bg-[#00ff80] text-black px-4 py-2 rounded font-black text-[10px] uppercase hover:bg-white transition-all shadow-[0_0_15px_rgba(0,255,128,0.3)]"
                >
                  Save Mission
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* INPUT AREA */}
        <form onSubmit={handleDirectiveSubmit} className="p-8 bg-gradient-to-t from-black to-transparent">
          <div className="max-w-4xl mx-auto relative group">
            <div className="absolute inset-0 bg-[#00ff80]/5 blur-xl group-focus-within:bg-[#00ff80]/10 transition-all rounded-full" />
            <div className="relative flex items-center gap-4 bg-[#050808] border border-[#00ff80]/20 p-4 rounded-2xl focus-within:border-[#00ff80]/60 transition-all shadow-2xl">
              <Plus size={20} className={isProcessing ? "animate-spin text-yellow-500" : "text-[#00ff80]/40"} />
              <input
                autoFocus
                className="flex-1 bg-transparent border-none outline-none text-[#00ff80] placeholder:text-[#00ff80]/20 text-lg"
                placeholder={isProcessing ? "Processing mission..." : "Awaiting directive..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isProcessing}
              />
            </div>
          </div>
        </form>
      </main>
    </div>
  );
};

export default Workspace;
