import React, { useState, useEffect, useRef, useMemo } from "react";
import { ChevronRight, Home, Clock, Archive, Trash2, Zap, Cpu, Settings, Shield, Activity, Lock } from "lucide-react";

// --- TYPES & INTERFACES ---
interface Mission {
  id: string;
  name: string;
  status: "home" | "recent" | "archived" | "trash";
  timestamp: string;
  priority: "low" | "med" | "high" | "critical";
}

interface TerminalLine {
  text: string;
  type: "system" | "user" | "error" | "success" | "warning";
  time: string;
}

const SYSTEM_PREFIX = "SYS_MSG >> ";
const BOOT_DELAY = 60;

const ActionTerminal = () => {
  // --- STATE ---
  const [input, setInput] = useState("");
  const [isBooted, setIsBooted] = useState(false);
  const [history, setHistory] = useState<TerminalLine[]>([]);
  const [activeTab, setActiveTab] = useState<"home" | "recent" | "archived" | "trash">("home");
  const [missions, setMissions] = useState<Mission[]>(() => {
    const saved = localStorage.getItem("nazai_v3_data");
    return saved
      ? JSON.parse(saved)
      : [
          { id: "SYS-1", name: "GLOBAL_DEPLOY_v1.9", status: "archived", timestamp: "2026-03-28", priority: "high" },
          { id: "SYS-2", name: "SECURITY_AUDIT_Q1", status: "archived", timestamp: "2026-03-15", priority: "critical" },
          { id: "SYS-3", name: "INFRA_MIGRATION", status: "archived", timestamp: "2026-03-01", priority: "med" },
        ];
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(
    () => ({
      home: missions.filter((m) => m.status === "home").length,
      recent: missions.filter((m) => m.status === "recent").length,
      archived: missions.filter((m) => m.status === "archived").length,
      trash: missions.filter((m) => m.status === "trash").length,
    }),
    [missions],
  );

  // --- BOOT SEQUENCE ---
  useEffect(() => {
    const bootLines: string[] = [
      "AUTHENTICATING_USER... [OK]",
      "LOADING_NAZAI_CORE_V3.0...",
      "ESTABLISHING_ENCRYPTED_TUNNEL... [OK]",
      "SYNCING_LOCAL_DATABASE...",
      "SCANNING_INTEGRITY... 100%",
      "-----------------------------------------",
      "WELCOME BACK, OPERATOR. SYSTEM IS LIVE.",
    ];

    let currentLine = 0;
    const interval = setInterval(() => {
      if (currentLine < bootLines.length) {
        addSystemLine(bootLines[currentLine], "system");
        currentLine++;
      } else {
        setIsBooted(true);
        clearInterval(interval);
      }
    }, BOOT_DELAY);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem("nazai_v3_data", JSON.stringify(missions));
  }, [missions]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const addSystemLine = (text: string, type: TerminalLine["type"] = "system") => {
    setHistory((prev) => [
      ...prev,
      {
        text: type === "system" ? `${SYSTEM_PREFIX}${text}` : text,
        type,
        time: new Date().toLocaleTimeString([], { hour12: false }),
      },
    ]);
  };

  const processCommand = (rawInput: string) => {
    const cleanInput = rawInput.trim();
    if (!cleanInput) return;

    setHistory((prev) => [...prev, { text: `> ${cleanInput}`, type: "user", time: new Date().toLocaleTimeString() }]);

    const [cmd, ...args] = cleanInput.toLowerCase().split(" ");
    const target = args.join(" ").toUpperCase();

    switch (cmd) {
      case "/help":
        addSystemLine("DIRECTIVES: /save [NAME], /archive [ID/NAME], /trash [ID/NAME], /clear", "warning");
        break;
      case "/save":
        const newM: Mission = {
          id: Math.random().toString(36).substr(2, 4).toUpperCase(),
          name: target || "NEW_TASK",
          status: "recent",
          timestamp: new Date().toISOString().split("T")[0],
          priority: "med",
        };
        setMissions((prev) => [newM, ...prev]);
        addSystemLine(`MISSION [${newM.id}] REGISTERED.`, "success");
        break;
      case "/clear":
        setHistory([]);
        break;
      default:
        addSystemLine(`COMMAND "${cmd}" NOT RECOGNIZED.`, "error");
    }
    setInput("");
  };

  return (
    <div className="flex h-screen bg-[#020606] text-[#00ff80] font-mono selection:bg-[#00ff80] selection:text-black overflow-hidden relative">
      {/* THE SINGLE UNIFIED SIDEBAR */}
      <aside className="w-72 bg-[#050808] border-r border-[#00ff80]/10 flex flex-col z-50">
        {/* TOP BRANDING */}
        <div className="p-6 border-b border-[#00ff80]/10 flex items-center gap-3">
          <div className="p-2 bg-[#00ff80]/10 rounded border border-[#00ff80]/20 text-[#00ff80]">
            <Cpu size={20} />
          </div>
          <div>
            <h2 className="text-sm font-black tracking-widest text-white uppercase leading-none">Nazai://OS</h2>
            <p className="text-[9px] opacity-40 uppercase tracking-[2px] mt-1">Unified Terminal</p>
          </div>
        </div>

        {/* SCROLLABLE NAV CONTENT */}
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
          {/* WORKSPACE NAVIGATION */}
          <section>
            <h3 className="text-[10px] opacity-20 font-bold uppercase tracking-[4px] mb-4 px-2">Navigation</h3>
            <nav className="space-y-1">
              <SidebarItem
                icon={<Home size={18} />}
                label="Home"
                active={activeTab === "home"}
                count={counts.home}
                onClick={() => setActiveTab("home")}
              />
              <SidebarItem
                icon={<Clock size={18} />}
                label="Recents"
                active={activeTab === "recent"}
                count={counts.recent}
                onClick={() => setActiveTab("recent")}
              />
              <SidebarItem
                icon={<Archive size={18} />}
                label="Archives"
                active={activeTab === "archived"}
                count={counts.archived}
                onClick={() => setActiveTab("archived")}
              />
              <SidebarItem
                icon={<Trash2 size={18} />}
                label="Trash"
                active={activeTab === "trash"}
                count={counts.trash}
                onClick={() => setActiveTab("trash")}
              />
            </nav>
          </section>

          {/* SYSTEM ASSETS STATS */}
          <section>
            <h3 className="text-[10px] opacity-20 font-bold uppercase tracking-[4px] mb-4 px-2">Live Assets</h3>
            <div className="space-y-4 px-2">
              {missions.slice(0, 3).map((m) => (
                <div key={m.id} className="group cursor-default">
                  <div className="flex justify-between text-[10px] font-bold mb-1 uppercase tracking-tighter opacity-40 group-hover:opacity-100 transition-opacity">
                    <span>{m.name}</span>
                    <span className="text-[#00ff80]/40">[{m.id}]</span>
                  </div>
                  <div className="w-full h-[1px] bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00ff80]/30 w-full group-hover:bg-[#00ff80] transition-all duration-500" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* BOTTOM USER PROFILE */}
        <div className="p-4 bg-black/40 border-t border-[#00ff80]/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#00ff80]/10 flex items-center justify-center border border-[#00ff80]/20 text-[#00ff80]">
            <Shield size={14} />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-[11px] font-bold text-white uppercase tracking-tighter truncate">Operator_Naz</p>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00ff80] animate-pulse" />
              <p className="text-[9px] text-blue-400 uppercase font-bold">Admin_Access</p>
            </div>
          </div>
          <Settings size={14} className="opacity-20 hover:opacity-100 cursor-pointer transition-opacity" />
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 flex flex-col bg-black relative">
        <header className="h-14 border-b border-[#00ff80]/10 flex items-center justify-between px-8 bg-black/40 backdrop-blur-md">
          <div className="flex gap-8">
            <StatusMetric icon={<Zap />} label="POWER" value="98%" />
            <StatusMetric icon={<Cpu />} label="CPU" value="12.4%" />
            <StatusMetric icon={<Lock />} label="SEC" value="AES-256" />
          </div>
          <Activity size={14} className="text-[#00ff80] animate-pulse opacity-50" />
        </header>

        {/* TERMINAL CONTENT */}
        <div ref={scrollRef} className="flex-1 p-10 overflow-y-auto space-y-4 font-mono scrollbar-hide">
          <div className="flex items-center gap-2 text-blue-400 mb-6 uppercase text-xs tracking-widest">
            <ChevronRight size={14} />
            <span>
              Directory: <span className="text-white">root/{activeTab}</span>
            </span>
          </div>

          {activeTab === "home" ? (
            history.map((line, i) => (
              <div
                key={i}
                className={`text-sm flex gap-4 ${line.type === "error" ? "text-red-500" : line.type === "success" ? "text-[#00ff80]" : ""}`}
              >
                <span className="opacity-20 text-[10px] min-w-[70px]">[{line.time}]</span>
                <span className="flex-1 break-all leading-relaxed">{line.text}</span>
              </div>
            ))
          ) : (
            <div className="space-y-4 animate-in fade-in duration-500">
              {missions
                .filter((m) => m.status === activeTab)
                .map((m) => (
                  <div
                    key={m.id}
                    className="flex gap-8 text-sm opacity-60 group hover:opacity-100 border-b border-white/5 pb-2 transition-all cursor-default"
                  >
                    <span className="text-blue-500 w-28 shrink-0 font-bold">{m.timestamp}</span>
                    <span className="flex-1 font-bold text-white uppercase tracking-wider">{m.name}</span>
                    <span className="opacity-30 uppercase text-[10px]">ID: {m.id}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* INPUT BOX */}
        <div className="p-8 bg-gradient-to-t from-black to-transparent">
          <div className="max-w-4xl mx-auto flex items-center gap-4 px-6 py-4 bg-[#00ff80]/5 rounded-xl border border-[#00ff80]/10 shadow-[0_0_30px_rgba(0,255,128,0.03)]">
            <ChevronRight className="text-[#00ff80]" size={20} />
            <input
              autoFocus
              className="flex-1 bg-transparent border-none outline-none text-[#00ff80] placeholder:text-[#00ff80]/10 font-mono tracking-wider"
              placeholder="Awaiting directive..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && processCommand(input)}
            />
          </div>
        </div>

        <div className="absolute inset-0 pointer-events-none z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.05)_50%),linear-gradient(90deg,rgba(255,0,0,0.01),rgba(0,255,0,0.01),rgba(0,0,255,0.01))] bg-[length:100%_3px,3px_100%] opacity-20" />
      </main>
    </div>
  );
};

// --- HELPERS ---
const SidebarItem = ({ icon, label, active, count, onClick }: any) => (
  <div
    onClick={onClick}
    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
      active
        ? "bg-[#00ff80]/10 text-white border border-[#00ff80]/20 shadow-[0_0_15px_rgba(0,255,128,0.05)]"
        : "text-gray-500 hover:bg-white/5 hover:text-white"
    }`}
  >
    <div className="flex items-center gap-3">
      <span className={active ? "text-[#00ff80]" : ""}>{icon}</span>
      <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
    </div>
    <span className="text-[10px] font-mono opacity-40">[{String(count).padStart(2, "0")}]</span>
  </div>
);

const StatusMetric = ({ icon, label, value }: any) => (
  <div className="flex items-center gap-2 group cursor-default">
    <div className="text-[#00ff80] opacity-40 group-hover:opacity-100 transition-opacity">
      {React.cloneElement(icon as React.ReactElement, { size: 14 })}
    </div>
    <div>
      <p className="text-[7px] opacity-30 font-black tracking-tighter leading-none uppercase">{label}</p>
      <p className="text-[10px] font-bold tracking-widest">{value}</p>
    </div>
  </div>
);

export default ActionTerminal;
