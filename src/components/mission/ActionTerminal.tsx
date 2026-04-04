import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Terminal,
  ChevronRight,
  LayoutGrid,
  Folder,
  Clock,
  Archive,
  Trash2,
  Zap,
  Cpu,
  Settings,
  Rocket,
  Shield,
  Search,
  Maximize2,
  Terminal as TerminalIcon,
  Activity,
  Lock,
} from "lucide-react";

// --- TYPES & INTERFACES ---
interface Mission {
  id: string;
  name: string;
  status: "active" | "draft" | "archived" | "trash";
  timestamp: string;
  priority: "low" | "med" | "high" | "critical";
  lastModified: number;
}

interface TerminalLine {
  text: string;
  type: "system" | "user" | "error" | "success" | "warning";
  time: string;
}

// --- CONSTANTS ---
const SYSTEM_PREFIX = "SYS_MSG >> ";
const BOOT_DELAY = 80;

interface ActionTerminalProps {
  activeSection?: string;
  initialDirective?: string;
}

const ActionTerminal: React.FC<ActionTerminalProps> = ({ activeSection, initialDirective }) => {
  // --- STATE ---
  const [input, setInput] = useState("");
  const [isBooted, setIsBooted] = useState(false);
  const [history, setHistory] = useState<TerminalLine[]>([]);
  const [activeTab, setActiveTab] = useState<"active" | "archived" | "trash" | "all">("active");
  const [missions, setMissions] = useState<Mission[]>(() => {
    const saved = localStorage.getItem("nazai_missions_v2");
    return saved ? JSON.parse(saved) : [];
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // --- MISSION MANAGEMENT LOGIC ---
  const counts = useMemo(
    () => ({
      active: missions.filter((m) => m.status === "active" || m.status === "draft").length,
      archived: missions.filter((m) => m.status === "archived").length,
      trash: missions.filter((m) => m.status === "trash").length,
      all: missions.length,
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

  // --- PERSISTENCE ---
  useEffect(() => {
    localStorage.setItem("nazai_missions_v2", JSON.stringify(missions));
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
    const target = args.join(" ");

    switch (cmd) {
      case "/help":
        addSystemLine("AVAILABLE DIRECTIVES:", "warning");
        addSystemLine("  /ls          - LIST ALL ACTIVE MISSIONS");
        addSystemLine("  /save [NAME] - INITIALIZE NEW MISSION");
        addSystemLine("  /archive [ID]- MOVE TO LONG-TERM STORAGE");
        addSystemLine("  /trash [ID]  - MARK FOR DELETION");
        addSystemLine("  /clear       - WIPE TERMINAL LOGS");
        break;

      case "/save":
        if (!target) {
          addSystemLine("ERROR: MISSION NAME REQUIRED", "error");
        } else {
          const newMission: Mission = {
            id: Math.random().toString(36).substr(2, 4).toUpperCase(),
            name: target.toUpperCase(),
            status: "active",
            priority: "med",
            timestamp: new Date().toLocaleDateString(),
            lastModified: Date.now(),
          };
          setMissions((prev) => [newMission, ...prev]);
          addSystemLine(`MISSION [${newMission.id}] "${newMission.name}" REGISTERED.`, "success");
        }
        break;

      case "/ls":
        if (missions.length === 0) {
          addSystemLine("DATABASE EMPTY.", "warning");
        } else {
          addSystemLine("RETRIEVING DATA ENTRIES...", "system");
          missions.forEach((m) => {
            addSystemLine(`[${m.id}] ${m.name} | STATUS: ${m.status} | PRIORITY: ${m.priority}`, "system");
          });
        }
        break;

      case "/archive":
        const toArchive = missions.find((m) => m.id === target.toUpperCase());
        if (toArchive) {
          setMissions((prev) => prev.map((m) => (m.id === target.toUpperCase() ? { ...m, status: "archived" } : m)));
          addSystemLine(`MISSION ${target.toUpperCase()} ARCHIVED.`, "success");
        } else {
          addSystemLine(`ID ${target.toUpperCase()} NOT FOUND.`, "error");
        }
        break;

      case "/trash":
        setMissions((prev) => prev.map((m) => (m.id === target.toUpperCase() ? { ...m, status: "trash" } : m)));
        addSystemLine(`MISSION ${target.toUpperCase()} RELOCATED TO TRASH.`, "warning");
        break;

      case "/clear":
        setHistory([]);
        break;

      default:
        addSystemLine(`COMMAND "${cmd}" NOT RECOGNIZED BY CORE.`, "error");
    }
    setInput("");
  };

  return (
    <div className="flex h-screen bg-[#050808] text-[#00ff80] font-mono overflow-hidden relative border-4 border-[#00ff80]/5">
      {/* SCANLINE OVERLAY */}
      <div className="absolute inset-0 pointer-events-none z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.02),rgba(0,255,0,0.01),rgba(0,0,255,0.02))] bg-[length:100%_3px,3px_100%] opacity-30" />

      {/* SIDEBAR */}
      <aside className="w-72 bg-black/60 backdrop-blur-xl border-r border-[#00ff80]/10 flex flex-col z-20">
        <div className="p-6 border-b border-[#00ff80]/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#00ff80]/10 rounded-lg">
              <TerminalIcon size={20} className="text-[#00ff80]" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-widest">NAZAI://OS</h1>
              <p className="text-[9px] opacity-40 uppercase">Business Terminal</p>
            </div>
          </div>
          <Activity size={14} className="text-[#00ff80] animate-pulse" />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-8">
          {/* NAVIGATION SECTION */}
          <section>
            <h2 className="text-[10px] uppercase opacity-30 font-bold mb-4 px-2 tracking-widest">Navigation</h2>
            <nav className="space-y-1">
              <SidebarItem
                icon={<Folder size={16} />}
                label="Active Missions"
                count={counts.active}
                active={activeTab === "active"}
                onClick={() => setActiveTab("active")}
              />
              <SidebarItem
                icon={<Clock size={16} />}
                label="All Recents"
                count={counts.all}
                active={activeTab === "all"}
                onClick={() => setActiveTab("all")}
              />
              <SidebarItem
                icon={<Archive size={16} />}
                label="Archives"
                count={counts.archived}
                active={activeTab === "archived"}
                onClick={() => setActiveTab("archived")}
              />
              <SidebarItem
                icon={<Trash2 size={16} />}
                label="Trash"
                count={counts.trash}
                active={activeTab === "trash"}
                onClick={() => setActiveTab("trash")}
              />
            </nav>
          </section>

          {/* PROJECT PREVIEWS */}
          <section>
            <h2 className="text-[10px] uppercase opacity-30 font-bold mb-4 px-2 tracking-widest">System Assets</h2>
            <div className="space-y-3 px-2">
              {missions
                .filter((m) => activeTab === "all" || m.status === activeTab)
                .slice(0, 5)
                .map((m) => (
                  <div key={m.id} className="group cursor-pointer">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold group-hover:text-white transition-colors">{m.name}</span>
                      <span className="text-[9px] opacity-30">[{m.id}]</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-[#00ff80]/40 w-3/4 group-hover:bg-[#00ff80] transition-all" />
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </div>

        {/* USER FOOTER */}
        <div className="p-4 bg-black/40 border-t border-[#00ff80]/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#00ff80]/20 flex items-center justify-center border border-[#00ff80]/20">
            <Shield size={16} />
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-bold">OPERATOR_NAZ</p>
            <p className="text-[9px] text-blue-400">ADMIN_ACCESS</p>
          </div>
          <Settings size={14} className="opacity-30 hover:opacity-100 cursor-pointer" />
        </div>
      </aside>

      {/* TERMINAL CONTENT */}
      <main className="flex-1 flex flex-col bg-black/20">
        {/* TOP STATUS BAR */}
        <div className="h-14 border-b border-[#00ff80]/10 flex items-center justify-between px-6 bg-black/40 backdrop-blur-md">
          <div className="flex items-center gap-8">
            <StatusMetric icon={<Zap />} label="POWER" value="98%" />
            <StatusMetric icon={<Cpu />} label="CPU_LOAD" value="12.4%" />
            <StatusMetric icon={<Lock />} label="ENCRYPTION" value="AES-256" />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-[#00ff80]/10 px-3 py-1 rounded border border-[#00ff80]/20">
              <div className="w-2 h-2 rounded-full bg-[#00ff80] animate-pulse" />
              <span className="text-[10px] font-bold tracking-widest">LIVE_CONNECTION</span>
            </div>
          </div>
        </div>

        {/* LOG OUTPUT */}
        <div ref={scrollRef} className="flex-1 p-8 overflow-y-auto space-y-2 font-mono scrollbar-hide">
          {history.map((line, i) => (
            <div
              key={i}
              className={`text-sm flex gap-4 animate-in fade-in slide-in-from-left-2 duration-300
                ${line.type === "error" ? "text-red-500" : ""}
                ${line.type === "warning" ? "text-yellow-500" : ""}
                ${line.type === "success" ? "text-blue-400" : ""}
                ${line.type === "user" ? "opacity-60" : ""}
              `}
            >
              <span className="opacity-20 text-[10px] min-w-[70px] pt-1">[{line.time}]</span>
              <span className="flex-1 break-all leading-relaxed whitespace-pre-wrap">{line.text}</span>
            </div>
          ))}
        </div>

        {/* COMMAND INPUT */}
        <div className="p-6 bg-black/60 border-t border-[#00ff80]/10 backdrop-blur-xl">
          <div className="max-w-5xl mx-auto flex items-center gap-4 px-6 py-4 bg-[#00ff80]/5 rounded-xl border border-[#00ff80]/20 shadow-[0_0_30px_rgba(0,255,128,0.05)]">
            <ChevronRight className="text-[#00ff80] animate-pulse" size={24} />
            <input
              autoFocus
              className="flex-1 bg-transparent border-none outline-none text-[#00ff80] placeholder:text-[#00ff80]/20 font-mono tracking-wider"
              placeholder="Awaiting directive..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && processCommand(input)}
            />
            <div className="flex gap-2">
              <span className="text-[10px] opacity-30 font-bold px-2 border border-white/10 rounded">L0</span>
              <span className="text-[10px] opacity-30 font-bold px-2 border border-white/10 rounded">CMD</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

// --- SUB-COMPONENTS ---
const SidebarItem = ({ icon, label, count, active, onClick }: any) => (
  <div
    onClick={onClick}
    className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all duration-200
      ${active ? "bg-[#00ff80]/10 text-[#00ff80] border border-[#00ff80]/20" : "text-white/40 hover:bg-white/5 hover:text-white"}
    `}
  >
    <div className="flex items-center gap-3">
      <span className={`${active ? "text-[#00ff80]" : "text-white/20 group-hover:text-[#00ff80]"} transition-colors`}>
        {icon}
      </span>
      <span className="text-[11px] font-black uppercase tracking-[0.15em]">{label}</span>
    </div>
    <div
      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-all
      ${active ? "border-[#00ff80]/40 text-[#00ff80]" : "border-white/10 opacity-40"}
    `}
    >
      {count.toString().padStart(2, "0")}
    </div>
  </div>
);

const StatusMetric = ({ icon, label, value }: any) => (
  <div className="flex items-center gap-2">
    <div className="text-[#00ff80] opacity-50">{React.cloneElement(icon as React.ReactElement, { size: 14 })}</div>
    <div>
      <p className="text-[8px] opacity-30 font-black tracking-tighter leading-none">{label}</p>
      <p className="text-[10px] font-bold tracking-widest">{value}</p>
    </div>
  </div>
);

export default ActionTerminal;
