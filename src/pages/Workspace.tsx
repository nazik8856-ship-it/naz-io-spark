import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Home, Clock, Archive, Trash2, Cpu, Settings, Shield, Plus, Search } from "lucide-react";

const Workspace = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // --- EXISTING LOGIC PRESERVED ---
  const [directive] = useState(() => {
    const saved = sessionStorage.getItem("nazai_directive");
    sessionStorage.removeItem("nazai_directive");
    return saved || "";
  });
  const [hydrating, setHydrating] = useState(true);

  // --- NEW TERMINAL STATE ---
  const [input, setInput] = useState("");
  const [lastSolution, setLastSolution] = useState<string | null>(null);
  const [missions, setMissions] = useState([
    { id: "SYS-1", name: "GLOBAL_DEPLOY_V1.9", status: "archived", date: "2026-03-28" },
    { id: "SYS-2", name: "SECURITY_AUDIT_Q1", status: "archived", date: "2026-03-15" },
  ]);
  const [history, setHistory] = useState([
    { time: "07:18:12", text: "AUTHENTICATING_USER... [OK]", type: "system" },
    { time: "07:18:12", text: "LOADING_NAZAI_CORE_V3.0...", type: "system" },
    { time: "07:18:12", text: "SYNCING_LOCAL_DATABASE...", type: "system" },
    { time: "07:18:12", text: "----------------------------------------", type: "system" },
    { time: "07:18:12", text: "WELCOME BACK, OPERATOR. SYSTEM IS LIVE.", type: "success" },
  ]);

  useEffect(() => {
    if (!loading && !user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => {
        setHydrating(false);
        // If there was a directive from the home page, auto-trigger it in the terminal
        if (directive) setLastSolution(`Executed Directive: ${directive}`);
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [user, directive]);

  // --- SAVE LOGIC ---
  const handleSaveMission = (solutionText: string) => {
    const newMission = {
      id: `SYS-${missions.length + 1}`,
      name: solutionText.substring(0, 15).toUpperCase() || "NEW_ENTRY",
      status: "archived",
      date: new Date().toISOString().split("T")[0],
    };
    setMissions([newMission, ...missions]);
    setLastSolution(null);
    setHistory((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        text: `SYS_MSG >> DATA_BLOCK [${newMission.id}] COMMITTED TO ARCHIVES.`,
        type: "success",
      },
    ]);
  };

  if (loading || !user) return null;

  // --- LOADING STATE PRESERVED ---
  if (hydrating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617]">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
          <div className="w-12 h-12 border-2 border-[#00ff80]/30 border-t-[#00ff80] rounded-full animate-spin" />
          <h2 className="text-lg font-mono text-[#00ff80] uppercase tracking-widest">
            {directive ? `Orchestrating Solution…` : "Initializing NazAI OS…"}
          </h2>
        </motion.div>
      </div>
    );
  }

  // --- RESTORED TERMINAL UI ---
  return (
    <div className="fixed inset-0 flex bg-[#020606] text-[#00ff80] font-mono overflow-hidden">
      {/* COLUMN 1: NAVIGATION & ASSETS */}
      <aside className="w-80 bg-[#050808] border-r border-[#00ff80]/10 flex flex-col">
        <div className="p-8 border-b border-[#00ff80]/10">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-2 bg-[#00ff80]/10 rounded-lg border border-[#00ff80]/20">
              <Cpu size={24} />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-[0.2em] text-white">NAZAI://OS</h1>
              <p className="text-[9px] text-[#00ff80]/40 font-bold uppercase">Direct Node Access</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <section>
            <h3 className="text-[10px] uppercase tracking-[0.3em] mb-4 text-[#00ff80]/30 font-bold">Navigation</h3>
            <div className="space-y-1">
              <NavItem icon={<Home size={18} />} label="Home" active />
              <NavItem icon={<Clock size={18} />} label="Recents" />
              <NavItem icon={<Archive size={18} />} label="Archives" count={missions.length} />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.3em] mb-4 text-[#00ff80]/30 font-bold">Live Assets</h3>
            <div className="space-y-3 px-2">
              {missions.map((m) => (
                <div key={m.id} className="group cursor-pointer">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-[10px] font-bold text-[#00ff80]/60 group-hover:text-[#00ff80] uppercase">
                      {m.name}
                    </span>
                    <span className="text-[9px] opacity-20">[{m.id}]</span>
                  </div>
                  <div className="h-[1px] w-full bg-[#00ff80]/10 group-hover:bg-[#00ff80]/40 transition-all" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>

      {/* COLUMN 2: TERMINAL CORE */}
      <main className="flex-1 flex flex-col bg-black relative">
        <header className="h-20 border-b border-[#00ff80]/10 flex items-center justify-between px-10">
          <div className="flex items-center gap-4">
            <ChevronRight size={14} className="text-blue-500" />
            <span className="text-[10px] font-bold tracking-widest uppercase">
              Directory: <span className="text-white">Root/Home</span>
            </span>
          </div>
        </header>

        <div className="flex-1 p-12 overflow-y-auto space-y-4">
          {history.map((log, i) => (
            <div key={i} className="flex gap-6 text-sm">
              <span className="opacity-20 text-[11px]">[{log.time}]</span>
              <span className={log.type === "success" ? "text-[#00ff80]" : "text-[#00ff80]/80"}>{log.text}</span>
            </div>
          ))}
        </div>

        {/* RESTORED SAVE BLOCK */}
        {lastSolution && (
          <div className="p-8 mx-10 mb-6 bg-[#00ff80]/5 border border-[#00ff80]/20 rounded-2xl border-l-4 border-l-[#00ff80] animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-[10px] font-black text-[#00ff80] tracking-widest mb-2 uppercase">The Solution</h4>
                <p className="text-xl text-white font-medium mb-4">{lastSolution}</p>
              </div>
              <button
                onClick={() => handleSaveMission(lastSolution)}
                className="flex items-center gap-2 px-4 py-2 bg-[#00ff80] text-black text-[10px] font-black uppercase rounded-lg hover:bg-white transition-all shadow-[0_0_15px_rgba(0,255,128,0.4)]"
              >
                <Archive size={14} /> Save Mission
              </button>
            </div>
          </div>
        )}

        {/* INPUT SECTION */}
        <div className="p-10 bg-gradient-to-t from-black to-transparent">
          <div className="max-w-5xl mx-auto relative flex items-center gap-4 p-5 bg-[#050808] border border-[#00ff80]/20 rounded-2xl focus-within:border-[#00ff80]/50 transition-all">
            <Plus size={20} className="text-[#00ff80]/40" />
            <input
              className="flex-1 bg-transparent border-none outline-none text-[#00ff80] placeholder:text-[#00ff80]/10 text-lg"
              placeholder="Awaiting directive..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

const NavItem = ({ icon, label, active, count }: any) => (
  <div
    className={`flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all ${active ? "bg-[#00ff80]/10 border border-[#00ff80]/20 text-white" : "text-[#00ff80]/40 hover:text-[#00ff80] hover:bg-white/5"}`}
  >
    <div className="flex items-center gap-4">
      {icon}
      <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
    </div>
    {count !== undefined && (
      <span className="text-[10px] font-mono opacity-40">[{count < 10 ? `0${count}` : count}]</span>
    )}
  </div>
);

export default Workspace;
