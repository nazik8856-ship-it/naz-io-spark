import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Zap,
  Cpu,
  Settings,
  Rocket,
  ShieldCheck,
  Plus,
  Image,
  FileText,
  ChevronLeft,
  RefreshCcw,
  Save,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import AuthModal from "@/components/AuthModal";
import { supabase } from "@/integrations/supabase/client";
import AttachmentChip, { type Attachment } from "./AttachmentChip";
import { useMissions } from "@/hooks/useMissions";
import { PROCESS_MISSION_FUNCTION } from "@/constants";

interface ActionTerminalProps {
  activeSection: string;
  initialDirective?: string;
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

const MAX_FILE_SIZE_MB = 50;
const MAX_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const PROMPT_TEMPLATES = [
  {
    label: "Go-to-Market Strategy",
    prompt: "Design a complete go-to-market strategy for a B2B SaaS product targeting SMEs, including pricing tiers, acquisition channels, and a 90-day launch plan.",
  },
  {
    label: "E-Commerce Business",
    prompt: "Create a full e-commerce business plan including product sourcing strategy, platform selection, conversion optimization tactics, and a profitable scaling framework.",
  },
  {
    label: "AI Automation",
    prompt: "Architect an AI automation system for a service business that reduces manual work by 80%, including tool stack recommendations, workflow diagrams, and ROI projections.",
  },
];

const HELP_PROMPTS = [
  ...PROMPT_TEMPLATES,
  {
    label: "Content Marketing Funnel",
    prompt: "Build a 6-month content marketing funnel that converts cold traffic into paying customers for a SaaS tool.",
  },
  {
    label: "Competitor Analysis",
    prompt: "Create a complete competitor analysis framework to enter a saturated market with a differentiated offer.",
  },
  {
    label: "Revenue Model",
    prompt: "Design a multi-stream revenue model for a digital platform, including subscription tiers, marketplace fees, and premium add-ons with projected unit economics.",
  },
  {
    label: "Growth Playbook",
    prompt: "Build a 90-day growth playbook for a pre-seed startup, covering product-market fit validation, early traction channels, and key metrics to track.",
  },
  {
    label: "Pitch Deck Strategy",
    prompt: "Create a compelling investor pitch deck strategy including narrative arc, market sizing, competitive moat, and financial projections for a Series A raise.",
  },
  {
    label: "Client Onboarding",
    prompt: "Design a fully automated client onboarding system that delivers a 5-star experience without human intervention.",
  },
];

const DECRYPTION_LINES = [
  "▶ DECRYPTING_PAYLOAD // AES-256-GCM ...",
  "▶ VERIFYING_SIGNATURE // RSA-4096 ...",
  "▶ DECOMPRESSING_STREAM // ZSTD-L19 ...",
  "▶ PARSING_INTELLIGENCE // NEURAL_MAP ...",
  "▶ ASSEMBLING_OUTPUT // RENDER_READY ✓",
];

/* ── Blinking Cursor ── */
const BlinkingCursor = () => (
  <motion.span
    animate={{ opacity: [1, 0] }}
    transition={{ duration: 0.7, repeat: Infinity, repeatType: "reverse" }}
    className="inline-block w-[2px] h-4 bg-[#00ff88] ml-0.5 align-middle"
  />
);

/* ── Scanline overlay ── */
const Scanlines = () => (
  <div
    className="pointer-events-none absolute inset-0 z-[2]"
    style={{
      backgroundImage:
        "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.015) 2px, rgba(0,255,136,0.015) 4px)",
    }}
  />
);

const SolutionDisplay = ({ data }: { data: string }) => {
  try {
    const parsed = JSON.parse(data);
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="space-y-8"
      >
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
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 * i, duration: 0.3 }}
              className="flex items-center gap-2 bg-[#00ff88]/5 px-3 py-1.5 rounded-lg border border-[#00ff88]/20"
            >
              <div className="w-1 h-1 rounded-full bg-[#00ff88]" />
              <span className="text-[10px] text-white/60 font-mono uppercase tracking-wider">{action}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    );
  } catch (e) {
    return <div className="text-white/80 text-sm whitespace-pre-wrap">{data}</div>;
  }
};

const ActionTerminal: React.FC<ActionTerminalProps> = ({ activeSection, initialDirective = "" }) => {
  const { user } = useAuth();
  const { saveMission } = useMissions();
  const [directive, setDirective] = useState(initialDirective);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(-1);
  const [missionStarted, setMissionStarted] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<{ msg: string; type?: "error" | "info" }[]>([]);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [missionOutput, setMissionOutput] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptionIndex, setDecryptionIndex] = useState(0);
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isAuthorized = !!user;

  useEffect(() => {
    if (initialDirective) setDirective(initialDirective);
  }, [initialDirective]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUploadMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ESC to close help panel */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showHelpPanel) setShowHelpPanel(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showHelpPanel]);

  const addLog = (msg: string, type: "error" | "info" = "info") => {
    setTerminalLogs((prev) => [...prev, { msg, type }].slice(-5));
  };

  const handleFileUpload = async (file: File) => {
    const {
      data: { session },
    } = await supabase.auth.refreshSession();
    if (!session) {
      setShowAuthModal(true);
      return;
    }
    if (file.size > MAX_BYTES) {
      addLog(`ERROR // ${file.name.toUpperCase()} // EXCEEDS_${MAX_FILE_SIZE_MB}MB`, "error");
      return;
    }
    setUploading(true);
    addLog(`INITIALIZING_UPLOAD // ${file.name.toUpperCase()}...`);
    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${file.name.split(".").pop()}`;
    const filePath = `${session.user.id}/${fileName}`;

    try {
      const { error } = await supabase.storage.from("mission-assets").upload(filePath, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("mission-assets").getPublicUrl(filePath);
      setAttachments((prev) => [...prev, { name: file.name, url: urlData.publicUrl, type: file.type }]);
      addLog(`ASSET_SYNCHRONIZED // ${file.name.toUpperCase()}`);
    } catch (err: any) {
      addLog(`UPLOAD_FAILED // ${err.message?.toUpperCase()}`, "error");
    } finally {
      setUploading(false);
      setShowUploadMenu(false);
    }
  };

  const startWorkflow = async () => {
    if (!directive.trim()) return;

    setMissionStarted(true);
    setWorkflowActive(true);
    setWorkflowStep(0);
    addLog("NODE_INIT // PARALLEL_EXECUTION_START");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const aiRequest = supabase.functions.invoke(PROCESS_MISSION_FUNCTION, {
        body: { directive },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      const stepInterval = setInterval(() => {
        setWorkflowStep((curr) => {
          if (curr >= WORKFLOW_STEPS.length - 1) {
            clearInterval(stepInterval);

            aiRequest
              .then(({ data, error }) => {
                if (error) throw error;

                setWorkflowActive(false);
                setIsDecrypting(true);
                setDecryptionIndex(0);
                addLog("DECRYPTION_SEQUENCE // INITIATED");

                let lineIdx = 0;
                const decryptInterval = setInterval(() => {
                  lineIdx++;
                  setDecryptionIndex(lineIdx);
                  if (lineIdx >= DECRYPTION_LINES.length) {
                    clearInterval(decryptInterval);
                    setTimeout(() => {
                      setIsDecrypting(false);
                      setMissionOutput(JSON.stringify(data));
                      addLog("DATA_LOCKED // SOLUTION_READY");
                      saveMission(
                        directive,
                        attachments.map((a) => a.url),
                      );
                    }, 800);
                  }
                }, 500);
              })
              .catch((err) => {
                addLog(`CORE_LOGIC_FAILURE // ${err.message?.toUpperCase()}`, "error");
                setWorkflowActive(false);
              });

            return curr;
          }
          return curr + 1;
        });
      }, 400);
    } catch (err: any) {
      addLog(`CRITICAL_ERR // ${err.message.toUpperCase()}`, "error");
      setWorkflowActive(false);
    }
  };

  const resetMission = () => {
    setMissionStarted(false);
    setMissionOutput(null);
    setDirective("");
    setAttachments([]);
    setWorkflowStep(-1);
    setIsDecrypting(false);
    setDecryptionIndex(0);
    addLog("SYSTEM_RESET // READY_FOR_INPUT");
  };

  const sectionLabel = SECTION_LABELS[activeSection] || "Home";

  return (
    <div className="flex-1 flex flex-col h-full selection:bg-[#00ff88]/20 overflow-hidden relative"
      style={{ background: "radial-gradient(ellipse at 50% 0%, #0A192F 0%, #050505 70%)" }}
    >
      <Scanlines />

      {!isAuthorized && (
        <AuthModal open={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={startWorkflow} />
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => Array.from(e.target.files || []).forEach(handleFileUpload)}
        multiple
      />

      {/* /help PANEL */}
      <AnimatePresence>
        {showHelpPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-50 bg-[#050505]/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="w-full max-w-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-mono font-black uppercase tracking-[0.3em] text-[#00ff88]"
                  style={{ filter: "drop-shadow(0 0 6px rgba(0,255,136,0.5))" }}
                >
                  📋 Golden Business Prompts
                </h2>
                <button
                  onClick={() => setShowHelpPanel(false)}
                  className="text-[9px] font-mono uppercase tracking-widest text-white/40 hover:text-[#00ff88] transition-colors"
                >
                  [ESC] Close
                </button>
              </div>
              <div className="h-px bg-gradient-to-r from-transparent via-[#00ff88]/30 to-transparent" />
              <div className="grid gap-3">
                {HELP_PROMPTS.map((item, i) => (
                  <motion.button
                    key={item.label}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.3 }}
                    onClick={() => {
                      setDirective(item.prompt);
                      setShowHelpPanel(false);
                    }}
                    className="w-full text-left p-4 rounded-xl border border-[#00ff88]/15 bg-[#0a0a0a]/80 hover:border-[#00ff88]/50 hover:bg-[#00ff88]/5 transition-all duration-200 group"
                    whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(0,255,136,0.1)" }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-[#00ff88]/70 group-hover:text-[#00ff88]"
                      style={{ filter: "drop-shadow(0 0 4px rgba(0,255,136,0.3))" }}
                    >
                      {item.label}
                    </span>
                    <p className="text-[11px] text-white/40 mt-1.5 leading-relaxed group-hover:text-white/70 transition-colors">
                      {item.prompt}
                    </p>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#00ff88]/10 bg-[#050505]/60 backdrop-blur-md shrink-0 z-10 relative">
        <Terminal size={14} className="text-[#00ff88]" style={{ filter: "drop-shadow(0 0 4px rgba(0,255,136,0.5))" }} />
        <span className="text-[10px] font-mono text-white/40 uppercase tracking-[0.2em]">
          NazAI:// <span className="text-[#00ff88] font-bold">{sectionLabel}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
            className={`w-1.5 h-1.5 rounded-full ${isAuthorized ? "bg-[#00ff88]" : "bg-red-500"}`}
            style={isAuthorized ? { boxShadow: "0 0 8px rgba(0,255,136,0.6)" } : {}}
          />
          <span className="text-[9px] text-white/30 font-mono font-bold tracking-wider uppercase">
            {isAuthorized ? "SECURE_LINK" : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* TERMINAL LOGS */}
      <div className="px-6 py-2 border-b border-[#00ff88]/5 bg-[#050505]/40 max-h-32 overflow-y-auto shrink-0 scrollbar-hide relative z-[3]">
        <AnimatePresence>
          {terminalLogs.map((log, i) => (
            <motion.p
              key={`${i}-${log.msg}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className={`text-[9px] font-mono tracking-widest ${log.type === "error" ? "text-red-400" : "text-[#00ff88]/50"}`}
            >
              <span className="text-[#00ff88]/30">❯</span> {log.msg}
            </motion.p>
          ))}
        </AnimatePresence>
      </div>

      {/* CONTENT AREA */}
      <div className="flex-1 flex flex-col p-8 overflow-y-auto relative z-[3]">
        {activeSection === "home" || activeSection === "drafts" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-12">
            {!missionStarted ? (
              <motion.form
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  isAuthorized ? startWorkflow() : setShowAuthModal(true);
                }}
                className="w-full max-w-2xl space-y-4"
              >
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((att, i) => (
                      <AttachmentChip
                        key={i}
                        attachment={att}
                        onRemove={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                      />
                    ))}
                  </div>
                )}

                {!directive.trim() && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="flex flex-wrap gap-3 mb-3"
                  >
                    {PROMPT_TEMPLATES.map((tpl, i) => (
                      <motion.button
                        key={tpl.label}
                        type="button"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 * i }}
                        onClick={() => setDirective(tpl.prompt)}
                        whileHover={{ scale: 1.05, boxShadow: "0 0 20px rgba(0,255,136,0.25)" }}
                        whileTap={{ scale: 0.95 }}
                        className="px-4 py-2 text-[9px] font-mono font-bold uppercase tracking-widest rounded-lg border border-[#00ff88]/30 bg-[#0a0a0a] text-[#00ff88]"
                        style={{ boxShadow: "0 0 12px rgba(0,255,136,0.1), inset 0 0 8px rgba(0,255,136,0.03)" }}
                      >
                        {tpl.label}
                      </motion.button>
                    ))}
                  </motion.div>
                )}

                <div className="relative flex items-start gap-4">
                  <div className="relative pt-2" ref={menuRef}>
                    <motion.button
                      type="button"
                      onClick={() => setShowUploadMenu(!showUploadMenu)}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      className="p-3 rounded-xl border border-[#00ff88]/20 bg-[#0a0a0a] hover:border-[#00ff88]/40 transition-all group"
                    >
                      <Plus size={18} className="text-white/30 group-hover:text-[#00ff88]" />
                    </motion.button>
                    <AnimatePresence>
                      {showUploadMenu && (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -8, scale: 0.95 }}
                          transition={{ duration: 0.2 }}
                          className="absolute left-0 mt-2 w-48 bg-[#0a0a0a]/98 border border-[#00ff88]/15 rounded-xl overflow-hidden z-[100] shadow-2xl"
                          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 12px rgba(0,255,136,0.05)" }}
                        >
                          {[
                            { label: "Image", icon: Image, click: () => fileInputRef.current?.click() },
                            { label: "Document", icon: FileText, click: () => fileInputRef.current?.click() },
                          ].map((item) => (
                            <button
                              key={item.label}
                              type="button"
                              onClick={item.click}
                              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#00ff88]/5 border-b border-white/5 last:border-0 transition-colors"
                            >
                              <item.icon size={14} className="text-[#00ff88]/40" />
                              <span className="text-[10px] text-white/50 font-mono uppercase tracking-widest">
                                {item.label}
                              </span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Textarea with glowing border + blinking cursor */}
                  <div className="flex-1 relative">
                    <textarea
                      value={directive}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.trim().toLowerCase() === "/help") {
                          setShowHelpPanel(true);
                          setDirective("");
                          return;
                        }
                        setDirective(val);
                      }}
                      placeholder={
                        activeSection === "drafts"
                          ? "CONTINUE WORKING ON DRAFT..."
                          : "TYPE /help FOR PROMPTS — OR DESCRIBE YOUR PROBLEM"
                      }
                      className="w-full rounded-2xl p-6 min-h-[140px] transition-all duration-300 outline-none font-mono text-sm text-[#00ff88] bg-[#050505] border-2 resize-none placeholder:text-white/15 placeholder:font-mono"
                      style={{
                        borderColor: isFocused ? "#00ff88" : "rgba(0,255,136,0.2)",
                        boxShadow: isFocused
                          ? "0 0 30px rgba(0,255,136,0.15), inset 0 0 20px rgba(0,255,136,0.03)"
                          : "0 0 10px rgba(0,255,136,0.05)",
                        caretColor: "#00ff88",
                      }}
                    />
                    {/* Blinking cursor indicator when empty */}
                    {!directive && !isFocused && (
                      <div className="absolute top-6 left-6 flex items-center">
                        <span className="text-sm font-mono text-white/10">_</span>
                        <BlinkingCursor />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <motion.button
                    type="submit"
                    disabled={!directive.trim() || uploading}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="ml-auto px-10 py-3.5 text-[10px] font-mono font-black uppercase tracking-[0.3em] rounded-xl transition-all disabled:opacity-10"
                    style={{
                      background: "linear-gradient(135deg, #00ff88, #00E0FF)",
                      color: "#050505",
                      boxShadow: directive.trim() ? "0 0 25px rgba(0,255,136,0.3), 0 0 50px rgba(0,255,136,0.1)" : "none",
                    }}
                  >
                    Execute Mission
                  </motion.button>
                </div>
              </motion.form>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-full max-w-3xl space-y-10"
              >
                <button
                  onClick={resetMission}
                  className="flex items-center gap-2 text-[9px] text-white/30 hover:text-[#00ff88] transition-colors uppercase font-mono font-black tracking-widest"
                >
                  <ChevronLeft size={12} /> New_Mission
                </button>

                <div className="grid grid-cols-4 gap-4">
                  {WORKFLOW_STEPS.map((step, i) => {
                    const isActive = workflowActive && workflowStep >= i;
                    const isDone = !workflowActive && missionOutput;
                    return (
                      <motion.div
                        key={step.label}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className={`flex flex-col items-center gap-3 p-5 rounded-xl border transition-all duration-500 ${
                          isActive || isDone
                            ? "border-[#00ff88]/40 bg-[#00ff88]/5"
                            : "border-white/5 opacity-20"
                        }`}
                        style={
                          isActive || isDone
                            ? { boxShadow: "0 0 20px rgba(0,255,136,0.1)" }
                            : {}
                        }
                      >
                        <step.icon
                          size={20}
                          className={isActive || isDone ? "text-[#00ff88]" : "text-white/30"}
                          style={isActive || isDone ? { filter: "drop-shadow(0 0 6px rgba(0,255,136,0.5))" } : {}}
                        />
                        <span className="text-[8px] font-mono font-black uppercase tracking-[0.2em]">
                          {step.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>

                <div
                  className="border border-[#00ff88]/10 rounded-[2rem] p-10 min-h-[300px] relative overflow-hidden"
                  style={{
                    background: "linear-gradient(180deg, rgba(0,255,136,0.02) 0%, rgba(5,5,5,0.95) 100%)",
                    boxShadow: "inset 0 1px 0 rgba(0,255,136,0.1), 0 0 40px rgba(0,0,0,0.5)",
                  }}
                >
                  {missionOutput ? (
                    <SolutionDisplay data={missionOutput} />
                  ) : isDecrypting ? (
                    <div className="flex flex-col gap-3 font-mono">
                      <AnimatePresence>
                        {DECRYPTION_LINES.slice(0, decryptionIndex + 1).map((line, i) => (
                          <motion.div
                            key={line}
                            initial={{ opacity: 0, x: -15 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.35, ease: "easeOut" }}
                            className="text-[10px] tracking-widest text-[#00ff88]/80 flex items-center gap-2"
                            style={{ filter: "drop-shadow(0 0 4px rgba(0,255,136,0.3))" }}
                          >
                            {line}
                            {i === decryptionIndex && <BlinkingCursor />}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 gap-4">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      >
                        <RefreshCcw className="text-[#00ff88]/40" size={24} />
                      </motion.div>
                      <p
                        className="text-[10px] text-[#00ff88] uppercase tracking-widest font-mono font-black"
                        style={{ filter: "drop-shadow(0 0 8px rgba(0,255,136,0.4))" }}
                      >
                        Neural Processing<BlinkingCursor />
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-[#00ff88]/10 rounded-2xl bg-[#00ff88]/[0.01] p-12 text-center">
            <ShieldCheck size={22} className="text-[#00ff88]/15 mb-4" />
            <p className="text-[10px] text-white/15 uppercase tracking-[0.3em] font-mono">{sectionLabel} // ARCHIVE_STABLE</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTerminal;
