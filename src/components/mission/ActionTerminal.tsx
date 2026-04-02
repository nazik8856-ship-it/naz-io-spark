import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  ChevronRight,
  Zap,
  Cpu,
  Settings,
  Rocket,
  Activity,
  Database,
  Trash2,
  FolderOpen,
} from "lucide-react";
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

// Logic steps for the Home execution engine
const WORKFLOW_STEPS = [
  { label: "INPUT_SENSOR", icon: Zap },
  { label: "LOGIC_GATE", icon: Cpu },
  { label: "AUTO_ENGINE", icon: Settings },
  { label: "EXECUTION", icon: Rocket },
];

const ActionTerminal: React.FC<ActionTerminalProps> = ({ activeSection }) => {
  const [directive, setDirective] = useState("");
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // RENDER HELPERS FOR SECTIONS
  const renderHeader = (title: string, subtitle: string, Icon: any) => (
    <div className="flex items-center gap-4 border-b border-white/5 pb-6 mb-8">
      <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
        <Icon size={20} className="text-[#00A3FF]" />
      </div>
      <div>
        <h2 className="text-sm font-bold text-white uppercase tracking-[0.2em]">{title}</h2>
        <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">{subtitle}</p>
      </div>
    </div>
  );

  const renderEmptyState = (message: string) => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl bg-blue-500/[0.02] p-12 text-center"
    >
      <div className="w-12 h-12 rounded-full bg-white/[0.02] flex items-center justify-center mb-4 border border-white/5">
        <FolderOpen size={18} className="text-white/20" />
      </div>
      <p className="text-[11px] text-white/30 uppercase tracking-[0.2em] font-medium">{message}</p>
      <div className="mt-4 flex gap-2">
        <div className="w-1 h-1 rounded-full bg-blue-500/40" />
        <div className="w-1 h-1 rounded-full bg-blue-500/20" />
        <div className="w-1 h-1 rounded-full bg-blue-500/10" />
      </div>
    </motion.div>
  );

  return (
    <div className="flex-1 flex flex-col bg-[#020617] h-full selection:bg-blue-500/30">
      {/* Top Bar Navigation Info */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#020617]/50 backdrop-blur-md shrink-0">
        <Terminal size={14} className="text-[#00A3FF]" />
        <span className="text-[10px] font-sans text-white/50 uppercase tracking-widest">
          System / <span className="text-white font-bold">{sectionLabel}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-[9px] text-blue-500/80 font-bold tracking-tighter">NODE_01_ACTIVE</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-8 overflow-y-auto">
        {activeSection === "home" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-12">
            <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-6">
              <div className="relative">
                <textarea
                  value={directive}
                  onChange={(e) => setDirective(e.target.value)}
                  placeholder="ENTER MISSION PARAMETERS..."
                  disabled={workflowActive}
                  rows={4}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-2xl text-white font-sans text-sm p-6 placeholder:text-white/10 outline-none resize-none focus:border-blue-500/50 focus:bg-blue-500/[0.02] transition-all disabled:opacity-50"
                />
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[9px] text-white/20 uppercase tracking-[0.2em]">Ready for orchestration</p>
                <button
                  type="submit"
                  disabled={workflowActive || !directive.trim()}
                  className="px-8 py-3 bg-[#00A3FF] text-white text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl hover:bg-blue-400 hover:shadow-[0_0_20px_rgba(0,163,255,0.3)] transition-all disabled:opacity-20"
                >
                  Start Mission
                </button>
              </div>
            </form>

            {/* Workflow Progress */}
            <div className="w-full max-w-2xl grid grid-cols-4 gap-4">
              {WORKFLOW_STEPS.map((step, i) => {
                const isActive = workflowActive && workflowStep >= i;
                const Icon = step.icon;
                return (
                  <div key={step.label} className="relative">
                    <div
                      className={`flex flex-col items-center gap-3 p-4 rounded-xl border transition-all duration-500 ${
                        isActive
                          ? "border-blue-500/40 bg-blue-500/10 shadow-[0_0_15px_rgba(0,163,255,0.1)]"
                          : "border-white/5 bg-white/[0.01]"
                      }`}
                    >
                      <Icon size={18} className={isActive ? "text-[#00A3FF]" : "text-white/10"} />
                      <span
                        className={`text-[8px] font-bold uppercase tracking-widest ${isActive ? "text-white" : "text-white/10"}`}
                      >
                        {step.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {activeSection === "recents" && (
              <>
                {renderHeader("Operations Feed", "Real-time deployment tracking", Activity)}
                {renderEmptyState("No active operations detected in this node")}
              </>
            )}
            {activeSection === "archives" && (
              <>
                {renderHeader("Data Archives", "Verified mission historical records", Database)}
                {renderEmptyState("Archive database currently synchronized")}
              </>
            )}
            {activeSection === "trash" && (
              <>
                {renderHeader("Recycle Bin", "Redundant data pending cleanup", Trash2)}
                {renderEmptyState("No data marked for decommissioning")}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTerminal;
