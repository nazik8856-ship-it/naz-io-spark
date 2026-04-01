import React, { useState, useEffect, useRef } from "react";
import { Terminal, ChevronRight } from "lucide-react";

interface ActionTerminalProps {
  activeSection: string;
}

const SECTION_HEADERS: Record<string, string> = {
  home: "MISSION_CONTROL // HOME_BASE",
  recents: "MISSION_CONTROL // RECENT_OPS",
  archives: "MISSION_CONTROL // ARCHIVES",
  trash: "MISSION_CONTROL // TRASH_BIN",
};

const SECTION_CONTENT: Record<string, string[]> = {
  home: [
    "[SYS] Welcome to NazAI Mission Control.",
    "[SYS] All subsystems operational.",
    "[SYS] Ready to receive directives.",
    "",
    "  STATUS: NOMINAL",
    "  UPTIME: 99.997%",
    "  ACTIVE_THREADS: 12",
    "  QUEUE_DEPTH: 0",
    "",
    "[TIP] Type a command or select a section from the sidebar.",
  ],
  recents: [
    "[LOG] Recent mission activity:",
    "",
    "  [01] DEPLOY_LANDING_v2  — 2m ago  — SUCCESS",
    "  [02] SCAN_ANOMALY_#447  — 14m ago — RESOLVED",
    "  [03] PATCH_AUTH_MODULE   — 1h ago  — SUCCESS",
    "  [04] REBUILD_CACHE       — 3h ago  — SUCCESS",
    "",
    "[SYS] 4 operations in the last 24h.",
  ],
  archives: [
    "[ARCHIVE] Stored mission records:",
    "",
    "  2026-03-28  GLOBAL_DEPLOY_v1.9   COMPLETE",
    "  2026-03-15  SECURITY_AUDIT_Q1    PASSED",
    "  2026-03-01  INFRA_MIGRATION      COMPLETE",
    "",
    "[SYS] 3 archived records found.",
  ],
  trash: [
    "[TRASH] Pending permanent deletion:",
    "",
    "  — draft_campaign_old    (7d remaining)",
    "  — test_endpoint_v0      (3d remaining)",
    "",
    "[WARN] Items auto-purge after 30 days.",
  ],
};

const ActionTerminal: React.FC<ActionTerminalProps> = ({ activeSection }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([]);
    const content = SECTION_CONTENT[activeSection] || SECTION_CONTENT.home;
    content.forEach((line, i) => {
      setTimeout(() => {
        setLines((prev) => [...prev, line]);
      }, i * 80);
    });
  }, [activeSection]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    setLines((prev) => [...prev, "", `> ${inputValue}`, `[SYS] Command "${inputValue}" acknowledged.`]);
    setInputValue("");
  };

  return (
    <div className="flex-1 flex flex-col bg-black h-full">
      {/* Terminal header bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#00A3FF]/20 bg-black shrink-0">
        <Terminal size={14} className="text-[#00A3FF]" />
        <span className="text-[9px] font-black text-[#00A3FF] uppercase tracking-[0.3em]">
          {SECTION_HEADERS[activeSection] || SECTION_HEADERS.home}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-2 h-2 bg-[#39FF14] shadow-[0_0_4px_#39FF14]" />
          <div className="w-2 h-2 bg-[#00A3FF] shadow-[0_0_4px_#00A3FF]" />
          <div className="w-2 h-2 bg-[#FF0055] shadow-[0_0_4px_#FF0055]" />
        </div>
      </div>

      {/* Terminal body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-1 font-mono">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`text-[11px] leading-relaxed ${
              line.startsWith("[WARN]")
                ? "text-[#FF0055]"
                : line.startsWith("[SYS]") || line.startsWith("[LOG]") || line.startsWith("[ARCHIVE]") || line.startsWith("[TRASH]") || line.startsWith("[TIP]")
                ? "text-[#00A3FF]"
                : line.startsWith(">")
                ? "text-[#39FF14]"
                : "text-white/60"
            }`}
          >
            {line || "\u00A0"}
          </div>
        ))}
      </div>

      {/* Input prompt */}
      <form onSubmit={handleSubmit} className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-[#00A3FF]/20 bg-black">
        <ChevronRight size={12} className="text-[#39FF14] shrink-0" />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="ENTER_COMMAND..."
          className="flex-1 bg-transparent text-[11px] text-white font-mono placeholder:text-white/20 outline-none caret-[#39FF14]"
        />
      </form>
    </div>
  );
};

export default ActionTerminal;
