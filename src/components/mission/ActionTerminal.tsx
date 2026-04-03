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

const SolutionDisplay = ({ data }: { data: string }) => {
  try {
    const parsed = JSON.parse(data);
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
        <div className="border-l-2 border-[#00A3FF] pl-6 py-1">
          <h3 className="text-[10px] uppercase tracking-[0.3em] text-[#00A3FF] mb-3 font-black">The Solution</h3>
          <p className="text-white text-base leading-relaxed font-medium">{parsed.solution}</p>
        </div>

        <div className="bg-white/[0.03] rounded-2xl p-6 border border-white/5">
          <h3 className="text-[9px] uppercase tracking-[0.2em] text-white/30 mb-3 font-bold">Analysis & Reasoning</h3>
          <p className="text-white/80 text-sm leading-relaxed">{parsed.explanation}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          {parsed.actions?.map((action: string, i: number) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-[#00A3FF]/5 px-3 py-1.5 rounded-lg border border-[#00A3FF]/10"
            >
              <div className="w-1 h-1 rounded-full bg-[#00A3FF]" />
              <span className="text-[10px] text-white/60 font-mono uppercase tracking-wider">{action}</span>
            </div>
          ))}
        </div>
      </div>
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
      // 1. Trigger the actual Intelligence Bridge (Edge Function)
      // This happens in parallel with the UI animation
      const { data: { session } } = await supabase.auth.getSession();
      const aiRequest = supabase.functions.invoke(PROCESS_MISSION_FUNCTION, {
        body: { directive },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      // 2. Animate the workflow steps for UX feel
      const stepInterval = setInterval(() => {
        setWorkflowStep((curr) => {
          if (curr >= WORKFLOW_STEPS.length - 1) {
            clearInterval(stepInterval);

            // 3. Resolve the AI Request and Display
            aiRequest
              .then(({ data, error }) => {
                if (error) throw error;

                setMissionOutput(JSON.stringify(data));
                setWorkflowActive(false);
                addLog("DATA_LOCKED // SOLUTION_READY");

                // 4. Persistence: Save the completed mission to DB
                saveMission(
                  directive,
                  attachments.map((a) => a.url),
                );
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
    addLog("SYSTEM_RESET // READY_FOR_INPUT");
  };

  const sectionLabel = SECTION_LABELS[activeSection] || "Home";

  return (
    <div className="flex-1 flex flex-col bg-[#020617] h-full selection:bg-blue-500/30 overflow-hidden relative">
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

      {/* HEADER */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#020617]/50 backdrop-blur-md shrink-0 z-10">
        <Terminal size={14} className="text-[#00A3FF]" />
        <span className="text-[10px] font-sans text-white/50 uppercase tracking-[0.2em]">
          System / <span className="text-white font-bold">{sectionLabel}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isAuthorized ? "bg-green-500" : "bg-blue-500"} animate-pulse`} />
          <span className="text-[9px] text-white/40 font-bold tracking-tighter uppercase">
            {isAuthorized ? "SESSION_ACTIVE" : "NODE_01_OFFLINE"}
          </span>
        </div>
      </div>

      {/* TERMINAL LOGS */}
      <div className="px-6 py-2 border-b border-white/5 bg-white/[0.01] max-h-32 overflow-y-auto shrink-0 scrollbar-hide">
        {terminalLogs.map((log, i) => (
          <p
            key={i}
            className={`text-[9px] font-mono tracking-widest ${log.type === "error" ? "text-red-400" : "text-[#00A3FF]/60"}`}
          >
            &gt; {log.msg}
          </p>
        ))}
      </div>

      {/* CONTENT AREA */}
      <div className="flex-1 flex flex-col p-8 overflow-y-auto">
        {activeSection === "home" || activeSection === "drafts" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-12">
            {!missionStarted ? (
              <form
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
                  <div className="flex flex-wrap gap-2 mb-2">
                    {PROMPT_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.label}
                        type="button"
                        onClick={() => setDirective(tpl.prompt)}
                        className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-lg border border-[#00A3FF]/20 bg-[#00A3FF]/5 text-[#00A3FF]/70 hover:bg-[#00A3FF]/15 hover:text-[#00A3FF] transition-all"
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="relative flex items-start gap-4">
                  <div className="relative pt-2" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setShowUploadMenu(!showUploadMenu)}
                      className="p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-all group"
                    >
                      <Plus size={18} className="text-white/40 group-hover:text-[#00A3FF]" />
                    </button>
                    {showUploadMenu && (
                      <div className="absolute left-0 mt-2 w-48 bg-[#0a1628]/98 border border-white/10 rounded-xl overflow-hidden z-[100] shadow-2xl">
                        {[
                          { label: "Image", icon: Image, click: () => fileInputRef.current?.click() },
                          { label: "Document", icon: FileText, click: () => fileInputRef.current?.click() },
                        ].map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={item.click}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.05] border-b border-white/5 last:border-0"
                          >
                            <item.icon size={14} className="text-[#00A3FF]/40" />
                            <span className="text-[10px] text-white/50 font-mono uppercase tracking-widest">
                              {item.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <textarea
                    value={directive}
                    onChange={(e) => setDirective(e.target.value)}
                    placeholder={
                      activeSection === "drafts"
                        ? "CONTINUE WORKING ON DRAFT..."
                        : "WHAT IS THE PROBLEM WE ARE SOLVING?"
                    }
                    className="flex-1 rounded-2xl p-6 min-h-[140px] transition-all duration-300 outline-none font-sans text-sm text-white bg-white/[0.06] border-2 border-[#00A3FF]/40 focus:border-[#00A3FF] shadow-neon-blue-soft resize-none"
                  />
                </div>

                <div className="flex justify-between items-center pt-2">
                  <button
                    type="submit"
                    disabled={!directive.trim() || uploading}
                    className="ml-auto px-10 py-3.5 bg-[#00A3FF] text-white text-[10px] font-black uppercase tracking-[0.3em] rounded-xl hover:bg-blue-400 transition-all disabled:opacity-10"
                  >
                    Get Solution
                  </button>
                </div>
              </form>
            ) : (
              <div className="w-full max-w-3xl space-y-10 animate-in fade-in zoom-in duration-700">
                <button
                  onClick={resetMission}
                  className="flex items-center gap-2 text-[9px] text-white/40 hover:text-[#00A3FF] transition-colors uppercase font-black"
                >
                  <ChevronLeft size={12} /> New Problem
                </button>

                <div className="grid grid-cols-4 gap-4">
                  {WORKFLOW_STEPS.map((step, i) => {
                    const isActive = workflowActive && workflowStep >= i;
                    const isDone = !workflowActive && missionOutput;
                    return (
                      <div
                        key={step.label}
                        className={`flex flex-col items-center gap-3 p-5 rounded-xl border transition-all duration-500 ${isActive || isDone ? "border-[#00A3FF]/40 bg-[#00A3FF]/10 scale-105" : "border-white/5 opacity-20"}`}
                      >
                        <step.icon size={20} className={isActive || isDone ? "text-[#00A3FF]" : "text-white"} />
                        <span className="text-[8px] font-black uppercase tracking-[0.2em]">{step.label}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-10 min-h-[300px] shadow-2xl">
                  {missionOutput ? (
                    <SolutionDisplay data={missionOutput} />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 gap-4">
                      <RefreshCcw className="animate-spin text-[#00A3FF]/40" size={24} />
                      <p className="text-[10px] text-[#00A3FF] animate-pulse uppercase tracking-widest font-black">
                        Engineered Thinking In Progress...
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl bg-blue-500/[0.02] p-12 text-center">
            <ShieldCheck size={22} className="text-[#00A3FF]/20 mb-4" />
            <p className="text-[10px] text-white/20 uppercase tracking-[0.3em]">{sectionLabel} // ARCHIVE_STABLE</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTerminal;
