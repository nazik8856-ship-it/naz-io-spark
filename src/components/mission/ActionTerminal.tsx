import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Terminal as TerminalIcon,
  ChevronRight,
  Home,
  Clock,
  Archive,
  Trash2,
  Zap,
  Cpu,
  Settings,
  Shield,
  Activity,
  Lock,
  X,
} from "lucide-react";

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

  // --- COUNTS FOR SIDEBARS ---
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
      "LOADING_NAZAI_CORE_V2.0.77...",
      "ESTABLISHING_ENCRYPTED_TUNNEL... [OK]",
      "SYNCING_LOCAL_DATABASE...",
      "SCANNING_INTEGRITY... 100%",
      "-----------------------------------------",
      "WELCOME BACK, OPERATOR. SYSTEM IS LIVE.",
      "STAY DANGEROUS. TYPE /HELP FOR DIRECTIVES.",
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

  // --- PERSISTENCE & SCROLL ---
  useEffect(() => {
    localStorage.setItem("nazai_v3_data", JSON.stringify(missions));
  }, [missions]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  // --- UTILITIES ---
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

  // --- COMMAND PROCESSOR ---
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
        addSystemLine(`MISSION [${newM.id}] REGISTERED IN RECENTS.`, "success");
        break;

      case "/archive":
        setMissions((prev) =>
          prev.map((m) => (m.id === target || m.name === target ? { ...m, status: "archived" } : m)),
        );
        addSystemLine(`ENTRY ${target} ARCHIVED.`, "success");
        break;

      case "/trash":
        setMissions((prev) => prev.map((m) => (m.id === target || m.name === target ? { ...m, status: "trash" } : m)));
        addSystemLine(`ENTRY ${target} MOVED TO TRASH.`, "warning");
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
      {/* 1. FAR LEFT: WORKSPACE */}
      <aside className="w-64 border-r border-[#00ff80]/10 bg-[#050808] flex flex-col z-30">
        <div className="p-6 border-b border-[#00ff80]/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded border border-blue-500/20 text-blue-400">
              <Cpu size={18} />
            </div>
            <span className="font-bold tracking-widest text-sm text-white uppercase">Workspace</span>
          </div>
          <X size={16} className="opacity-40 cursor-pointer" />
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <WorkspaceItem
            icon={<Home size={18} />}
            label="Home"
            active={activeTab === "home"}
            onClick={() => setActiveTab("home")}
          />
          <WorkspaceItem
            icon={<Clock size={18} />}
            label="Recents"
            active={activeTab === "recent"}
            onClick={() => setActiveTab("recent")}
          />
          <WorkspaceItem
            icon={<Archive size={18} />}
            label="Archives"
            active={activeTab === "archived"}
            onClick={() => setActiveTab("archived")}
          />
          <WorkspaceItem
            icon={<Trash2 size={18} />}
            label="Trash"
            active={activeTab === "trash"}
            onClick={() => setActiveTab("trash")}
          />
        </nav>

        <div className="p-6 mt-auto text-center border-t border-[#00ff80]/10 opacity-30 text-[10px] tracking-[4px]">
          SECURE_NODE // SYNCHRONIZED
        </div>
      </aside>

      {/* 2. MIDDLE: MISSION CONTROL */}
      <aside className="w-72 bg-[#020606] border-r border-[#00ff80]/5 flex flex-col z-20">
        <div className="p-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#00ff80]/10 border border-[#00ff80]/20 flex items-center justify-center">
            <ChevronRight className="text-[#00ff80]" />
          </div>
          <div>
            <h2 className="text-sm font-black tracking-tighter uppercase text-white">Nazai://OS</h2>
            <p className="text-[9px] opacity-40 uppercase tracking-[2px]">Business Terminal</p>
          </div>
          <Activity size={14} className="ml-auto text-[#00ff80] animate-pulse" />
        </div>

        <div className="px-6 py-4 space-y-8 flex-1">
          <section>
            <h3 className="text-[10px] opacity-30 font-bold uppercase tracking-widest mb-4">Navigation</h3>
            <div className="space-y-1">
              <MissionTab label="Active Missions" count={counts.home} active={activeTab === "home"} />
              <MissionTab label="All Recents" count={counts.recent} active={activeTab === "recent"} />
              <MissionTab label="Archives" count={counts.archived} active={activeTab === "archived"} />
              <MissionTab label="Trash" count={counts.trash} active={activeTab === "trash"} />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] opacity-30 font-bold uppercase tracking-widest mb-4">System Assets</h3>
            <div className="space-y-4 px-1">
              {missions.slice(0, 3).map((m) => (
                <div key={m.id} className="group cursor-pointer">
                  <div className="flex justify-between text-[10px] font-bold mb-1 uppercase tracking-tighter opacity-60 group-hover:opacity-100 transition-opacity">
                    <span>{m.name}</span>
                    <span className="opacity-40">[{m.id}]</span>
                  </div>
                  <div className="w-full h-[2px] bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00ff80]/40 w-full group-hover:bg-[#00ff80] transition-all" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="p-4 bg-black/40 border-t border-[#00ff80]/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#00ff80]/20 flex items-center justify-center border border-[#00ff80]/20 text-[#00ff80]">
            <Shield size={14} />
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-bold text-white uppercase tracking-tighter">Operator_Naz</p>
            <p className="text-[9px] text-blue-400 uppercase tracking-tighter font-bold">Admin_Access</p>
          </div>
          <Settings size={14} className="opacity-20 hover:opacity-100 cursor-pointer" />
        </div>
      </aside>

      {/* 3. MAIN TERMINAL AREA */}
      <main className="flex-1 flex flex-col bg-black relative">
        <header className="h-14 border-b border-[#00ff80]/10 flex items-center justify-between px-8 bg-black/40 backdrop-blur-md">
          <div className="flex gap-8">
            <StatusMetric icon={<Zap />} label="POWER" value="98%" />
            <StatusMetric icon={<Cpu />} label="CPU_LOAD" value="12.4%" />
            <StatusMetric icon={<Lock />} label="ENCRYPTION" value="AES-256" />
          </div>
          <div className="flex items-center gap-3 bg-[#00ff80]/10 px-4 py-1.5 rounded-full border border-[#00ff80]/20">
            <div className="w-2 h-2 rounded-full bg-[#00ff80] animate-pulse" />
            <span className="text-[10px] font-bold tracking-widest uppercase">Live_Connection</span>
          </div>
        </header>

        {/* TERMINAL CONTENT */}
        <div ref={scrollRef} className="flex-1 p-10 overflow-y-auto space-y-4 font-mono scrollbar-hide">
          <div className="flex items-center gap-2 text-blue-400 mb-6">
            <ChevronRight size={16} />
            <span className="text-sm">
              Welcome to the <span className="text-white font-bold capitalize">{activeTab}</span> section.
            </span>
          </div>

          {activeTab === "home" ? (
            history.map((line, i) => (
              <div
                key={i}
                className={`text-sm flex gap-4 ${line.type === "error" ? "text-red-500" : line.type === "success" ? "text-blue-400" : ""}`}
              >
                <span className="opacity-20 text-[10px] min-w-[70px]">[{line.time}]</span>
                <span className="flex-1 break-all leading-relaxed">{line.text}</span>
              </div>
            ))
          ) : (
            <div className="space-y-4 animate-in fade-in duration-500">
              <p className="text-blue-400 opacity-80 uppercase tracking-widest">[ARCHIVE] Stored mission records:</p>
              <div className="space-y-2 mt-6">
                {missions
                  .filter((m) => m.status === activeTab)
                  .map((m) => (
                    <div
                      key={m.id}
                      className="flex gap-8 text-sm opacity-70 group hover:opacity-100 border-b border-white/5 pb-2 transition-all cursor-default"
                    >
                      <span className="text-blue-500 w-28 shrink-0 font-bold">{m.timestamp}</span>
                      <span className="flex-1 font-bold text-white uppercase">{m.name}</span>
                      <span className="opacity-30 uppercase tracking-widest">Status: {m.status}</span>
                    </div>
                  ))}
              </div>
              <p className="text-blue-400 pt-6 opacity-50 uppercase text-[12px] font-bold tracking-tighter">
                [SYS] {missions.filter((m) => m.status === activeTab).length} archived records found.
              </p>
            </div>
          )}
        </div>

        {/* INPUT BOX */}
        <div className="p-8 bg-black/80 border-t border-[#00ff80]/5">
          <div className="max-w-5xl mx-auto flex items-center gap-4 px-6 py-4 bg-[#00ff80]/5 rounded-xl border border-[#00ff80]/10 shadow-[0_0_30px_rgba(0,255,128,0.03)]">
            <ChevronRight className="text-[#00ff80]" size={24} />
            <input
              autoFocus
              className="flex-1 bg-transparent border-none outline-none text-[#00ff80] placeholder:text-[#00ff80]/10 font-mono tracking-wider"
              placeholder="Awaiting directive..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && processCommand(input)}
            />
            <div className="flex gap-2">
              <span className="text-[10px] opacity-30 font-bold px-2 border border-white/10 rounded uppercase">L0</span>
              <span className="text-[10px] opacity-30 font-bold px-2 border border-white/10 rounded uppercase">
                Cmd
              </span>
            </div>
          </div>
        </div>

        {/* SCANLINE OVERLAY */}
        <div className="absolute inset-0 pointer-events-none z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.05)_50%),linear-gradient(90deg,rgba(255,0,0,0.01),rgba(0,255,0,0.01),rgba(0,0,255,0.01))] bg-[length:100%_3px,3px_100%] opacity-20" />
      </main>
    </div>
  );
};

// --- HELPERS ---
const WorkspaceItem = ({ icon, label, active, onClick }: any) => (
  <div
    onClick={onClick}
    className={`flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-all ${active ? "bg-blue-600/20 text-white border border-blue-500/20 shadow-[0_0_15px_rgba(37,99,235,0.1)]" : "text-gray-500 hover:bg-white/5 hover:text-white"}`}
  >
    <span className={active ? "text-blue-400" : ""}>{icon}</span>
    <span className="text-sm font-bold tracking-tight">{label}</span>
  </div>
);

const MissionTab = ({ label, count, active }: any) => (
  <div
    className={`flex items-center justify-between p-3 rounded border transition-all cursor-pointer ${active ? "bg-[#00ff80]/10 border-[#00ff80]/40 text-[#00ff80]" : "border-transparent text-white/30 hover:bg-white/5"}`}
  >
    <div className="flex items-center gap-3">
      <div className={`w-3 h-3 border ${active ? "bg-[#00ff80] border-[#00ff80]" : "border-white/20"}`} />
      <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
    </div>
    <span className="text-[10px] font-mono">[{String(count).padStart(2, "0")}]</span>
  </div>
);

const StatusMetric = ({ icon, label, value }: any) => (
  <div className="flex items-center gap-2 group">
    <div className="text-[#00ff80] opacity-50 group-hover:opacity-100 transition-opacity">
      {React.cloneElement(icon as React.ReactElement, { size: 14 })}
    </div>
    <div>
      <p className="text-[8px] opacity-30 font-black tracking-tighter leading-none uppercase">{label}</p>
      <p className="text-[10px] font-bold tracking-widest">{value}</p>
    </div>
  </div>
);

export default ActionTerminal;
