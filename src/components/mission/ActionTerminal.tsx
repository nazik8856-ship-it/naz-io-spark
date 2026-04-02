import React, { useState } from "react";
import {
  Terminal,
  Zap,
  Cpu,
  Settings,
  Rocket,
  Activity,
  Database,
  Trash2,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";

interface ActionTerminalProps {
  activeSection: string;
  initialDirective?: string;
}

const SECTION_LABELS: Record<string, string> = {
  home: "Home",
  recents: "Recents",
  archives: "Archives",
  trash: "Trash",
};

const WORKFLOW_STEPS = [
  { label: "Input Sensor", icon: Zap },
  { label: "Logic Gate", icon: Cpu },
  { label: "Auto Engine", icon: Settings },
  { label: "Execution", icon: Rocket },
];

const ActionTerminal: React.FC<ActionTerminalProps> = ({ activeSection, initialDirective = "" }) => {
  const [directive, setDirective] = useState(initialDirective);
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(-1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directive.trim()) return;
    setWorkflowActive(true);
    setWorkflowStep(0);

    WORKFLOW_STEPS.forEach((_, i) => {
      setTimeout(
        () => {
          setWorkflowStep(i);
          if (i === WORKFLOW_STEPS.length - 1) {
            setTimeout(() => {
              setWorkflowActive(false);
              setWorkflowStep(-1);
              setDirective("");
            }, 1200);
          }
        },
        (i + 1) * 900,
      );
    });
  };

  const sectionLabel = SECTION_LABELS[activeSection] || "Home";

  const renderEmptyState = (message: string) => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 flex flex-col items-center justify-center p-12 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mb-5">
        <FolderOpen size={20} className="text-white/15" />
      </div>
      <p className="text-sm text-white/30 font-medium mb-1">No active records found</p>
      <p className="text-xs text-white/15">{message}</p>
    </motion.div>
  );

  const renderSectionHeader = (title: string, subtitle: string, Icon: any) => (
    <div className="flex items-center gap-4 border-b border-white/5 pb-5 mb-6">
      <div className="p-2.5 bg-[#00A3FF]/5 rounded-xl border border-[#00A3FF]/10">
        <Icon size={18} className="text-[#00A3FF]" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="text-xs text-white/30 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full" style={{ background: "#020617", fontFamily: "'Inter', sans-serif" }}>
      {/* Top Bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <Terminal size={14} className="text-[#00A3FF]" />
        <span className="text-xs text-white/40">
          System / <span className="text-white font-medium">{sectionLabel}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00A3FF] animate-pulse" />
          <span className="text-[10px] text-[#00A3FF]/60 font-medium">Active</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-8 overflow-y-auto">
        {activeSection === "home" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-10">
            {/* Welcome header */}
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white mb-2">Welcome to NazAI</h1>
              <p className="text-sm text-white/30">Enter a directive to initialize your first mission.</p>
            </div>

            <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-4">
              <div className="relative">
                <textarea
                  value={directive}
                  onChange={(e) => setDirective(e.target.value)}
                  placeholder="ENTER_MISSION_DIRECTIVE...."
                  disabled={workflowActive}
                  rows={4}
                  className="w-full rounded-2xl text-white text-sm p-6 outline-none resize-none transition-all disabled:opacity-50 placeholder:text-white/10"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(57, 255, 20, 0.25)",
                    boxShadow: directive ? "0 0 20px rgba(57, 255, 20, 0.08)" : "none",
                    fontFamily: "'Inter', sans-serif",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "rgba(57, 255, 20, 0.5)";
                    e.currentTarget.style.boxShadow = "0 0 30px rgba(57, 255, 20, 0.1)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "rgba(57, 255, 20, 0.25)";
                    e.currentTarget.style.boxShadow = directive ? "0 0 20px rgba(57, 255, 20, 0.08)" : "none";
                  }}
                />
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[11px] text-white/15">Ready for orchestration</p>
                <button
                  type="submit"
                  disabled={workflowActive || !directive.trim()}
                  className="px-6 py-2.5 text-white text-xs font-semibold rounded-xl transition-all disabled:opacity-20 flex items-center gap-2"
                  style={{ background: "#00A3FF" }}
                >
                  <Sparkles size={14} />
                  Initialize Mission
                </button>
              </div>
            </form>

            {/* Workflow Progress */}
            <div className="w-full max-w-2xl grid grid-cols-4 gap-3">
              {WORKFLOW_STEPS.map((step, i) => {
                const isActive = workflowActive && workflowStep >= i;
                const Icon = step.icon;
                return (
                  <div
                    key={step.label}
                    className={`flex flex-col items-center gap-2.5 p-4 rounded-xl border transition-all duration-500 ${
                      isActive
                        ? "border-[#00A3FF]/30 bg-[#00A3FF]/5"
                        : "border-white/5 bg-white/[0.01]"
                    }`}
                  >
                    <Icon size={16} className={isActive ? "text-[#00A3FF]" : "text-white/10"} />
                    <span className={`text-[10px] font-medium text-center ${isActive ? "text-white" : "text-white/10"}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {activeSection === "recents" && (
              <>
                {renderSectionHeader("Operations Feed", "Real-time deployment tracking", Activity)}
                {renderEmptyState("No recent operations to display")}
              </>
            )}
            {activeSection === "archives" && (
              <>
                {renderSectionHeader("Data Archives", "Historical mission records", Database)}
                {renderEmptyState("Archive is empty — complete missions to populate")}
              </>
            )}
            {activeSection === "trash" && (
              <>
                {renderSectionHeader("Recycle Bin", "Items pending deletion", Trash2)}
                {renderEmptyState("Nothing has been discarded")}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTerminal;
