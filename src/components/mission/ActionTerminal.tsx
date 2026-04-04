// src/components/ActionTerminal.tsx
// NazAI — Upgraded with: Decryption logic, stable logs, and refined UI flow
// ✅ All existing Supabase / auth / useMissions logic preserved

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Terminal,
  Zap,
  Cpu,
  Settings,
  Rocket,
  Plus,
  Image,
  FileText,
  RefreshCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import AuthModal from "@/components/AuthModal";
import { supabase } from "@/integrations/supabase/client";
import AttachmentChip, { type Attachment } from "./AttachmentChip";
import { useMissions } from "@/hooks/useMissions";
import { PROCESS_MISSION_FUNCTION } from "@/constants";

// --- Interfaces & Constants ---
interface TerminalEntry {
  id: string;
  type: "input" | "output" | "system" | "error" | "decrypting";
  text: string;
  status: "active" | "archived" | "trash";
}

const SECTION_LABELS: Record<string, string> = {
  home: "Home",
  drafts: "Drafts",
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

const DECRYPTION_LINES = [
  "▶ DECRYPTING_PAYLOAD // AES-256-GCM ...",
  "▶ VERIFYING_SIGNATURE // RSA-4096 ...",
  "▶ DECOMPRESSING_STREAM // ZSTD-L19 ...",
  "▶ PARSING_INTELLIGENCE // NEURAL_MAP ...",
  "▶ ASSEMBLING_OUTPUT // RENDER_READY ✓",
];

const BOOT_SEQUENCE = [
  "NAZAI_OS v2.077 — INITIALIZING...",
  "► Mounting neural uplink ................. [OK]",
  "► Decrypting identity matrix ............. [OK]",
  "► Loading business protocol stack ........ [OK]",
  "► Bypassing corporate firewall ........... [OK]",
  "SYSTEM READY — Type /help or use a chip below.",
];

const COMMAND_CHIPS = [
  {
    label: "⚡ Go-to-Market",
    command: "Design a complete go-to-market strategy for a B2B SaaS product targeting SMEs.",
  },
  {
    label: "🤖 AI Automation",
    command: "Architect an AI automation system for a service business that reduces manual work by 80%.",
  },
  { label: "📋 /help", command: "/help" },
];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// --- Sub-Components ---

const BlinkingCursor = () => (
  <motion.span
    animate={{ opacity: [1, 0] }}
    transition={{ duration: 0.7, repeat: Infinity, repeatType: "reverse" }}
    className="inline-block w-[2px] h-4 bg-[#00ff88] ml-0.5 align-middle"
  />
);

const Scanlines = () => (
  <div
    className="pointer-events-none absolute inset-0 z-[2]"
    style={{
      backgroundImage:
        "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.015) 2px, rgba(0,255,136,0.015) 4px)",
    }}
  />
);

const TypewriterText = ({ text, speed = 14, className = "" }: { text: string; speed?: number; className?: string }) => {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    indexRef.current = 0;
    const interval = setInterval(() => {
      if (indexRef.current < text.length) {
        setDisplayed(text.slice(0, indexRef.current + 1));
        indexRef.current++;
      } else {
        clearInterval(interval);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <span className={className}>
      {displayed}
      {!done && (
        <motion.span
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.6, repeat: Infinity }}
          className="inline-block w-[6px] h-[10px] bg-[#00ff88]/60 ml-0.5 align-middle"
        />
      )}
    </span>
  );
};

const SolutionDisplay = ({ data }: { data: string }) => {
  try {
    const parsed = JSON.parse(data);
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
        <div className="border-l-2 border-[#00ff88] pl-6 py-1">
          <h3 className="text-[10px] uppercase tracking-[0.3em] text-[#00ff88] mb-3 font-black">The Solution</h3>
          <p className="text-white text-base leading-relaxed font-medium">{parsed.solution}</p>
        </div>
        <div className="bg-white/[0.03] rounded-2xl p-6 border border-[#00ff88]/10">
          <h3 className="text-[9px] uppercase tracking-[0.2em] text-white/30 mb-3 font-bold">Analysis & Reasoning</h3>
          <p className="text-white/80 text-sm leading-relaxed">{parsed.explanation}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {parsed.actions?.map((action: string, i: number) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-[#00ff88]/5 px-3 py-1.5 rounded-lg border border-[#00ff88]/20"
            >
              <div className="w-1 h-1 rounded-full bg-[#00ff88]" />
              <span className="text-[10px] text-white/60 font-mono uppercase tracking-wider">{action}</span>
            </div>
          ))}
        </div>
      </motion.div>
    );
  } catch (e) {
    return <div className="text-white/80 text-sm whitespace-pre-wrap">{data}</div>;
  }
};

// --- Main Component ---

const ActionTerminal: React.FC<{ activeSection: string; initialDirective?: string }> = ({
  activeSection,
  initialDirective = "",
}) => {
  const { user } = useAuth();
  const { saveMission } = useMissions();

  const [directive, setDirective] = useState(initialDirective);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(-1);
  const [missionStarted, setMissionStarted] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<{ id: string; msg: string; type?: "error" | "info" }[]>([]);
  const [missionOutput, setMissionOutput] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptionIndex, setDecryptionIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [isBooting, setIsBooting] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const isAuthorized = !!user;

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLogs]);

  useEffect(() => {
    const runBoot = async () => {
      setIsBooting(true);
      for (let i = 0; i < BOOT_SEQUENCE.length; i++) {
        await sleep(300);
        addLog(BOOT_SEQUENCE[i]);
      }
      setIsBooting(false);
    };
    runBoot();
  }, []);

  const addLog = useCallback((msg: string, type: "error" | "info" = "info") => {
    setTerminalLogs((prev) => [...prev, { id: genId(), msg, type }].slice(-10));
  }, []);

  const startWorkflow = async () => {
    if (!directive.trim()) return;
    setMissionStarted(true);
    setWorkflowActive(true);
    setWorkflowStep(0);
    addLog("NODE_INIT // PARALLEL_EXECUTION_START");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const aiRequest = supabase.functions.invoke(PROCESS_MISSION_FUNCTION, {
        body: { directive },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      // Workflow animation
      const stepInterval = setInterval(() => {
        setWorkflowStep((curr) => {
          if (curr >= WORKFLOW_STEPS.length - 1) {
            clearInterval(stepInterval);
            handleAiResponse(aiRequest);
            return curr;
          }
          return curr + 1;
        });
      }, 600);
    } catch (err: any) {
      addLog(`CRITICAL_ERR // ${err.message.toUpperCase()}`, "error");
      setWorkflowActive(false);
    }
  };

  const handleAiResponse = async (request: Promise<any>) => {
    try {
      const { data, error } = await request;
      if (error) throw error;

      setWorkflowActive(false);
      setIsDecrypting(true);
      setDecryptionIndex(0);
      addLog("DECRYPTION_SEQUENCE // INITIATED");

      // Decryption sequence animation
      for (let i = 0; i <= DECRYPTION_LINES.length; i++) {
        setDecryptionIndex(i);
        await sleep(500);
      }

      setIsDecrypting(false);
      setMissionOutput(JSON.stringify(data));
      addLog("DATA_LOCKED // SOLUTION_READY");
      saveMission(
        directive,
        attachments.map((a) => a.url),
      );
    } catch (err: any) {
      addLog(`CORE_LOGIC_FAILURE // ${err.message?.toUpperCase()}`, "error");
      setWorkflowActive(false);
    }
  };

  const resetMission = () => {
    setMissionStarted(false);
    setMissionOutput(null);
    setDirective("");
    setAttachments([]);
    setWorkflowStep(-1);
    addLog("SYSTEM_RESET // READY_FOR_INPUT");
  };

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden relative"
      style={{ background: "radial-gradient(ellipse at 50% 0%, #0A192F 0%, #050505 70%)" }}
    >
      <Scanlines />

      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#00ff88]/10 bg-[#050505]/60 backdrop-blur-md shrink-0 z-10">
        <Terminal size={14} className="text-[#00ff88]" />
        <span className="text-[10px] font-mono text-white/40 uppercase tracking-[0.2em]">
          NazAI:// <span className="text-[#00ff88] font-bold">{SECTION_LABELS[activeSection] || "Home"}</span>
        </span>
      </div>

      {/* Terminal Logs */}
      <div className="px-6 py-2 border-b border-[#00ff88]/5 bg-[#050505]/40 max-h-36 overflow-y-auto shrink-0 z-[3]">
        {terminalLogs.map((log) => (
          <p
            key={log.id}
            className={`text-[9px] font-mono tracking-widest ${log.type === "error" ? "text-red-400" : "text-[#00ff88]/60"}`}
          >
            <span className="text-[#00ff88]/30">❯</span> <TypewriterText text={log.msg} speed={10} />
          </p>
        ))}
        <div ref={logsEndRef} />
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col p-8 overflow-y-auto relative z-[3]">
        {!missionStarted ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <form
              className="w-full max-w-2xl space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                isAuthorized ? startWorkflow() : setShowAuthModal(true);
              }}
            >
              <div className="flex flex-wrap gap-2 mb-1">
                {COMMAND_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setDirective(chip.command)}
                    className="px-4 py-1.5 text-[9px] font-mono font-black uppercase tracking-widest rounded-lg border border-[#00ff88]/35 bg-[#0a0a0a] text-[#00ff88]"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <textarea
                value={directive}
                onChange={(e) => setDirective(e.target.value)}
                placeholder="DESCRIBE YOUR PROBLEM OR TYPE /help"
                className="w-full rounded-2xl p-6 min-h-[140px] bg-[#050505] border-2 border-[#00ff88]/20 text-[#00ff88] font-mono outline-none focus:border-[#00ff88] transition-all"
              />
              <button
                type="submit"
                className="w-full py-4 bg-[#00ff88] text-[#050505] font-black uppercase tracking-widest rounded-xl"
              >
                Execute Mission
              </button>
            </form>
          </div>
        ) : (
          <div className="w-full max-w-3xl mx-auto space-y-10">
            {/* Progress / Decryption / Result View */}
            {workflowActive && (
              <div className="flex justify-center gap-8">
                {WORKFLOW_STEPS.map((step, i) => (
                  <div
                    key={i}
                    className={`flex flex-col items-center gap-2 ${workflowStep >= i ? "text-[#00ff88]" : "text-white/10"}`}
                  >
                    <step.icon size={20} />
                    <span className="text-[8px] font-mono uppercase">{step.label}</span>
                  </div>
                ))}
              </div>
            )}

            {isDecrypting && (
              <div className="space-y-2 font-mono">
                {DECRYPTION_LINES.slice(0, decryptionIndex).map((line, i) => (
                  <p key={i} className="text-[#00ff88] text-xs">
                    <TypewriterText text={line} />
                  </p>
                ))}
              </div>
            )}

            {missionOutput && (
              <>
                <SolutionDisplay data={missionOutput} />
                <div className="flex gap-4 pt-6">
                  <button
                    onClick={() => setMissionStarted(false)}
                    className="flex items-center gap-2 px-6 py-3 border border-[#00ff88]/30 rounded-xl text-[#00ff88] text-[10px] font-mono uppercase hover:bg-[#00ff88]/10"
                  >
                    <RefreshCcw size={14} /> Refine Directive
                  </button>
                  <button
                    onClick={resetMission}
                    className="flex items-center gap-2 px-6 py-3 bg-[#00ff88]/10 border border-[#00ff88]/50 rounded-xl text-[#00ff88] text-[10px] font-mono uppercase"
                  >
                    New Mission
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <AuthModal open={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={startWorkflow} />
    </div>
  );
};

export default ActionTerminal;
