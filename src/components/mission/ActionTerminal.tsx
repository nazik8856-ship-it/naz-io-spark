import React, { useState, useEffect } from "react";
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
  Mail,
  X,
  Loader2,
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

const WORKFLOW_STEPS = [
  { label: "INPUT_SENSOR", icon: Zap },
  { label: "LOGIC_GATE", icon: Cpu },
  { label: "AUTO_ENGINE", icon: Settings },
  { label: "EXECUTION", icon: Rocket },
];

const ActionTerminal: React.FC<ActionTerminalProps> = ({ activeSection }) => {
  const [directive, setDirective] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false); // New state to show solution after login
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(-1);

  // TRIGGER 1: Click "Start Mission" -> Show Auth Modal
  const handleStartMission = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directive.trim()) return;
    setShowAuthModal(true);
  };

  // TRIGGER 2: Mock Authentication Completion
  const simulateLogin = (provider: string) => {
    setIsAuthenticating(true);
    // Simulate high-class SaaS delay for "Connection"
    setTimeout(() => {
      setIsAuthenticating(false);
      setShowAuthModal(false);
      setIsAuthorized(true);
      startWorkflow();
    }, 1800);
  };

  const startWorkflow = () => {
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
              // This is where you'd typically navigate to a /solution page
            }, 1200);
          }
        },
        (i + 1) * 900,
      );
    });
  };

  const sectionLabel = SECTION_LABELS[activeSection] || "Home";

  return (
    <div className="flex-1 flex flex-col bg-[#020617] h-full selection:bg-blue-500/30 overflow-hidden relative">
      {/* ── AUTH MODAL OVERLAY ── */}
      <AnimatePresence>
        {showAuthModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="w-full max-w-md bg-white/[0.03] backdrop-blur-2xl border border-white/10 p-8 rounded-3xl shadow-2xl relative"
            >
              <button
                onClick={() => setShowAuthModal(false)}
                className="absolute top-6 right-6 text-white/20 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>

              <div className="text-center mb-8">
                <h2 className="text-xl font-bold text-white tracking-tight">Account Required</h2>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mt-2">
                  Initialize access to orchestrate your solution
                </p>
              </div>

              {isAuthenticating ? (
                <div className="py-12 flex flex-col items-center gap-4">
                  <Loader2 className="text-[#00A3FF] animate-spin" size={32} />
                  <p className="text-[10px] text-[#00A3FF] font-bold uppercase tracking-[0.2em]">
                    Authenticating Node...
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={() => simulateLogin("google")}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-black rounded-xl font-bold text-xs hover:bg-white/90 transition-all"
                  >
                    <img
                      src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                      className="w-4 h-4"
                      alt="Google"
                    />
                    Continue with Google
                  </button>
                  <button
                    onClick={() => simulateLogin("apple")}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black border border-white/10 text-white rounded-xl font-bold text-xs hover:bg-white/5 transition-all"
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 384 512">
                      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
                    </svg>
                    Continue with Apple
                  </button>
                  <div className="py-4 flex items-center gap-4">
                    <div className="flex-1 h-px bg-white/5" />
                    <span className="text-[8px] text-white/20 uppercase tracking-widest">or</span>
                    <div className="flex-1 h-px bg-white/5" />
                  </div>
                  <div className="relative group">
                    <Mail
                      size={14}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-[#00A3FF]"
                    />
                    <input
                      type="email"
                      placeholder="Work Email"
                      className="w-full bg-white/[0.03] border border-white/5 rounded-xl py-3 pl-11 pr-4 text-xs text-white outline-none focus:border-[#00A3FF]/50 transition-all"
                    />
                  </div>
                  <button
                    onClick={() => simulateLogin("email")}
                    className="w-full py-3 bg-[#00A3FF] text-white rounded-xl font-bold text-xs hover:bg-blue-400 shadow-lg shadow-blue-500/20 transition-all"
                  >
                    Continue
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MAIN TERMINAL UI ── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#020617]/50 backdrop-blur-md shrink-0">
        <Terminal size={14} className="text-[#00A3FF]" />
        <span className="text-[10px] font-sans text-white/50 uppercase tracking-widest">
          System / <span className="text-white font-bold">{sectionLabel}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isAuthorized ? "bg-green-500" : "bg-blue-500"} animate-pulse`} />
          <span className="text-[9px] text-white/40 font-bold tracking-tighter">
            {isAuthorized ? "SESSION_ACTIVE" : "NODE_01_ACTIVE"}
          </span>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-8 overflow-y-auto">
        {activeSection === "home" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-12">
            {!isAuthorized ? (
              <form onSubmit={handleStartMission} className="w-full max-w-2xl space-y-6">
                <div className="relative">
                  <textarea
                    value={directive}
                    onChange={(e) => setDirective(e.target.value)}
                    placeholder="ENTER MISSION PARAMETERS..."
                    rows={4}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-2xl text-white font-sans text-sm p-6 placeholder:text-white/10 outline-none resize-none focus:border-blue-500/50 focus:bg-blue-500/[0.02] transition-all"
                  />
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-[9px] text-white/20 uppercase tracking-[0.2em]">
                    Authentication required to execute
                  </p>
                  <button
                    type="submit"
                    disabled={!directive.trim()}
                    className="px-8 py-3 bg-[#00A3FF] text-white text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl hover:bg-blue-400 hover:shadow-[0_0_20px_rgba(0,163,255,0.3)] transition-all disabled:opacity-20"
                  >
                    Start Mission Now
                  </button>
                </div>
              </form>
            ) : (
              /* ── SOLUTION VIEW (POST-AUTH) ── */
              <div className="w-full max-w-2xl space-y-8 animate-in fade-in zoom-in duration-700">
                <div className="text-center space-y-2">
                  <h3 className="text-[#00A3FF] text-[10px] font-black uppercase tracking-[0.4em]">
                    Solution Orchestrated
                  </h3>
                  <p className="text-white/60 text-xs italic">"{directive}"</p>
                </div>

                {/* Workflow Display */}
                <div className="grid grid-cols-4 gap-4">
                  {WORKFLOW_STEPS.map((step, i) => {
                    const isActive = workflowActive && workflowStep >= i;
                    const Icon = step.icon;
                    return (
                      <div
                        key={step.label}
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
                    );
                  })}
                </div>

                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 text-center">
                  <p className="text-white/40 text-[10px] uppercase tracking-widest">
                    Displaying localized solution data...
                  </p>
                  <div className="mt-4 h-32 flex items-center justify-center border border-dashed border-white/10 rounded-xl">
                    <p className="text-[10px] text-white/20 animate-pulse uppercase tracking-[0.2em]">
                      Processing Node Output...
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── OTHER SECTIONS REMAIN CLEAN ── */
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl bg-blue-500/[0.02] p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-white/[0.02] flex items-center justify-center mb-4 border border-white/5">
              <FolderOpen size={18} className="text-white/20" />
            </div>
            <p className="text-[11px] text-white/30 uppercase tracking-[0.2em] font-medium">
              Node Synchronized // No Records Found
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTerminal;
