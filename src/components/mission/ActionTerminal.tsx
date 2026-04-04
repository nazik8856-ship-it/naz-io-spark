import React, { useState, useEffect, useRef } from "react";
import { Terminal, ChevronRight, Zap, Cpu, Settings, Rocket } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ActionTerminalProps {
  activeSection: string;
}

const SECTION_LABELS: Record<string, string> = {
  home: "Home",
  recents: "Recents",
  archives: "Archives",
  trash: "Trash",
};

const WORKFLOW_STEPS = [
  { label: "INPUT_SENSOR", icon: Zap },
  { label: "LOGIC_GATE", icon: Cpu },
  { label: "AUTO_ENGINE", icon: Settings },
  { label: "EXECUTION", icon: Rocket },
];

const SECTION_CONTENT: Record<string, string[]> = {
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
  const [directive, setDirective] = useState("");
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Non-home sections: typed log lines
  useEffect(() => {
    if (activeSection === "home") return;
    setLines([]);
    const content = SECTION_CONTENT[activeSection] || [];
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
    if (!directive.trim()) return;
    setWorkflowActive(true);
    setWorkflowStep(0);

    WORKFLOW_STEPS.forEach((_, i) => {
      setTimeout(() => {
        setWorkflowStep(i);
        if (i === WORKFLOW_STEPS.length - 1) {
          setTimeout(() => {
            setWorkflowActive(false);
            setWorkflowStep(-1);
            setDirective("");
          }, 1200);
        }
      }, (i + 1) * 900);
    });
  };

  const sectionLabel = SECTION_LABELS[activeSection] || "Home";

  return (
    <div className="flex-1 flex flex-col bg-black h-full">
      {/* Dynamic header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#00A3FF]/20 bg-black shrink-0">
        <Terminal size={14} className="text-[#00A3FF]" />
        <span className="text-[11px] font-mono text-white/70">
          Welcome to the <span className="text-[#00A3FF] font-black">{sectionLabel}</span> section.
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-2 h-2 bg-[#39FF14] shadow-[0_0_4px_#39FF14]" />
          <div className="w-2 h-2 bg-[#00A3FF] shadow-[0_0_4px_#00A3FF]" />
          <div className="w-2 h-2 bg-[#FF0055] shadow-[0_0_4px_#FF0055]" />
        </div>
      </div>

      {activeSection === "home" ? (
        /* ── HOME: Orchestration Hub ── */
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">
          {/* Centered directive input */}
          <form onSubmit={handleSubmit} className="w-full max-w-2xl flex flex-col gap-4">
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              placeholder="ENTER_MISSION_DIRECTIVE...."
              disabled={workflowActive}
              rows={5}
              className="w-full bg-black border border-[#39FF14]/50 shadow-[0_0_15px_rgba(57,255,20,0.15),inset_0_0_15px_rgba(57,255,20,0.05)] text-white font-mono text-sm p-4 placeholder:text-white/20 outline-none resize-none focus:border-[#39FF14] focus:shadow-[0_0_25px_rgba(57,255,20,0.25),inset_0_0_20px_rgba(57,255,20,0.08)] transition-all disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={workflowActive || !directive.trim()}
              className="self-end px-6 py-2 border border-[#39FF14]/50 bg-[#39FF14]/10 text-[#39FF14] text-[10px] font-black uppercase tracking-[0.3em] hover:bg-[#39FF14]/20 hover:shadow-[0_0_15px_rgba(57,255,20,0.2)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              EXECUTE
            </button>
          </form>

          {/* Workflow Animator */}
          <div className="w-full max-w-2xl">
            <div className="flex items-center justify-between gap-0">
              {WORKFLOW_STEPS.map((step, i) => {
                const isActive = workflowActive && workflowStep >= i;
                const isCurrent = workflowActive && workflowStep === i;
                const Icon = step.icon;

                return (
                  <React.Fragment key={step.label}>
                    <motion.div
                      className={`flex flex-col items-center gap-2 px-3 py-3 border transition-all ${
                        isActive
                          ? "border-[#39FF14]/60 bg-[#39FF14]/10 shadow-[0_0_12px_rgba(57,255,20,0.2)]"
                          : "border-white/10 bg-white/[0.02]"
                      }`}
                      animate={isCurrent ? { scale: [1, 1.05, 1] } : {}}
                      transition={{ repeat: Infinity, duration: 0.8 }}
                    >
                      <Icon
                        size={16}
                        className={isActive ? "text-[#39FF14]" : "text-white/20"}
                      />
                      <span
                        className={`text-[7px] font-black uppercase tracking-[0.2em] ${
                          isActive ? "text-[#39FF14]" : "text-white/20"
                        }`}
                      >
                        {step.label}
                      </span>
                    </motion.div>
                    {i < WORKFLOW_STEPS.length - 1 && (
                      <div
                        className={`flex-1 h-px mx-1 transition-all duration-500 ${
                          workflowActive && workflowStep > i
                            ? "bg-[#39FF14] shadow-[0_0_6px_#39FF14]"
                            : "bg-white/10"
                        }`}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ── OTHER SECTIONS: Log terminal ── */
        <>
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
            className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-[#00A3FF]/20 bg-black"
          >
            <ChevronRight size={12} className="text-[#39FF14] shrink-0" />
            <input
              type="text"
              placeholder="ENTER_COMMAND..."
              className="flex-1 bg-transparent text-[11px] text-white font-mono placeholder:text-white/20 outline-none caret-[#39FF14]"
            />
          </form>
        </>
      )}
    </div>
  );
};

export default ActionTerminal;
