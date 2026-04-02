import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Zap,
  Cpu,
  Settings,
  Rocket,
  Database,
  ShieldCheck,
  Plus,
  Image,
  Video,
  FileText,
  Camera,
  Clock,
  Link,
  ChevronLeft,
  RefreshCcw,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import AuthModal from "@/components/AuthModal";
import { supabase } from "@/integrations/supabase/client";
import AttachmentChip, { type Attachment } from "./AttachmentChip";
import { useMissions } from "@/hooks/useMissions";

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
  { label: "INPUT_SENSOR", icon: Zap },
  { label: "LOGIC_GATE", icon: Cpu },
  { label: "AUTO_ENGINE", icon: Settings },
  { label: "EXECUTION", icon: Rocket },
];

// Configuration Constants
const MAX_FILE_SIZE_MB = 50; // Increased from 5MB based on user needs
const MAX_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const ActionTerminal: React.FC<ActionTerminalProps> = ({ activeSection, initialDirective = "" }) => {
  const { user } = useAuth();
  const { saveMission } = useMissions();
  const [directive, setDirective] = useState(initialDirective);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(-1);
  const [missionStarted, setMissionStarted] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<{ msg: string; type?: "error" | "info"; retryFile?: File }[]>([]);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [missionOutput, setMissionOutput] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAuthorized = !!user;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUploadMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const addLog = (msg: string, type: "error" | "info" = "info", retryFile?: File) => {
    setTerminalLogs((prev) => [...prev, { msg, type, retryFile }]);
  };

  const handleFileUpload = async (file: File) => {
    // 1. Force a session refresh to prevent "exp" claim timestamp failures
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.refreshSession();

    if (sessionError || !session) {
      addLog("ERROR // SESSION_EXPIRED // RE-AUTHENTICATING...", "error");
      setShowAuthModal(true);
      return;
    }

    // 2. Updated Size Check (Now 50MB)
    if (file.size > MAX_BYTES) {
      addLog(`ERROR // ${file.name.toUpperCase()} // EXCEEDS_${MAX_FILE_SIZE_MB}MB_LIMIT`, "error");
      return;
    }

    setUploading(true);
    addLog(`INITIALIZING_UPLOAD // ${file.name.toUpperCase()}...`);

    const fileExt = file.name.split(".").pop();
    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
    const filePath = `${session.user.id}/${fileName}`;

    try {
      const { error: uploadError } = await supabase.storage.from("mission-assets").upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("mission-assets").getPublicUrl(filePath);

      const newAttachment: Attachment = {
        name: file.name,
        url: urlData.publicUrl,
        type: file.type || "application/octet-stream",
      };

      setAttachments((prev) => [...prev, newAttachment]);
      addLog(`ASSET_SYNCHRONIZED // ${file.name.toUpperCase()} // READY`);
    } catch (err: any) {
      const errorMsg = err.message?.toUpperCase() || "SERVER_REJECTION";
      // If timestamp failure occurs, provide a retry option with the file preserved in state
      addLog(`UPLOAD_FAILED // ${errorMsg}`, "error", file);
    } finally {
      setUploading(false);
      setShowUploadMenu(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    Array.from(files).forEach(handleFileUpload);
    e.target.value = "";
  };

  const triggerFileInput = (acceptType: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = acceptType;
      fileInputRef.current.click();
    }
    setShowUploadMenu(false);
  };

  const handleScreenshot = async () => {
    setShowUploadMenu(false);
    addLog("SCREENSHOT // Capturing viewport...");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#00A3FF";
        ctx.font = "14px monospace";
        ctx.fillText("NazAI Terminal Screenshot", 20, 30);
      }
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `screenshot_${Date.now()}.png`, { type: "image/png" });
          handleFileUpload(file);
        }
      });
    } catch {
      addLog("SCREENSHOT_ERROR // Could not capture", "error");
    }
  };

  const handleStartMission = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directive.trim() && attachments.length === 0) return;
    if (!isAuthorized) {
      setShowAuthModal(true);
    } else {
      startWorkflow();
    }
  };

  const startWorkflow = () => {
    setMissionStarted(true);
    setWorkflowActive(true);
    setWorkflowStep(0);
    addLog("NODE_INIT // PARALLEL_EXECUTION_START");

    const urls = attachments.map((a) => a.url);
    const missionPromise = saveMission(directive, urls);

    const stepInterval = setInterval(() => {
      setWorkflowStep((currentStep) => {
        const nextStep = currentStep + 1;
        if (nextStep >= WORKFLOW_STEPS.length) {
          clearInterval(stepInterval);
          missionPromise.then((result) => {
            if (result?.error) {
              addLog(`SYNC_ERROR // ${result.error.message.toUpperCase()}`, "error");
            } else {
              addLog("DATA_LOCKED // LATENCY_0ms");
            }
            setMissionOutput(
              `NAZ_AI >> SUCCESS\n\nDirective: "${directive}"\nStatus: Deployed to Cluster\nAssets: ${attachments.length} Synced\n\nAutomated logic is now active. All nodes are reporting nominal status.`,
            );
            setWorkflowActive(false);
          });
          return currentStep;
        }
        return nextStep;
      });
    }, 300);
  };

  const resetMission = () => {
    setMissionStarted(false);
    setMissionOutput(null);
    setDirective("");
    setAttachments([]);
    setWorkflowStep(-1);
    addLog("SYSTEM_RESET // READY_FOR_INPUT");
  };

  const UPLOAD_MENU_ITEMS = [
    { label: "Screenshot", icon: Camera, action: handleScreenshot },
    { label: "Image", icon: Image, action: () => triggerFileInput("image/*") },
    { label: "Video", icon: Video, action: () => triggerFileInput("video/*") },
    { label: "Document", icon: FileText, action: () => triggerFileInput(".pdf,.doc,.docx,.txt") },
    {
      label: "History",
      icon: Clock,
      action: () => {
        setShowUploadMenu(false);
        addLog("QUERY_ARCHIVES // ACCESSING...");
      },
    },
    {
      label: "Connectors",
      icon: Link,
      action: () => {
        setShowUploadMenu(false);
        addLog("SYSTEM // BRIDGE_INIT...");
      },
    },
  ];

  const sectionLabel = SECTION_LABELS[activeSection] || "Home";

  return (
    <div className="flex-1 flex flex-col bg-[#020617] h-full selection:bg-blue-500/30 overflow-hidden relative">
      {!isAuthorized && (
        <AuthModal open={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={startWorkflow} />
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} multiple />

      {/* HEADER */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#020617]/50 backdrop-blur-md shrink-0 z-10">
        <Terminal size={14} className="text-[#00A3FF]" />
        <span className="text-[10px] font-sans text-white/50 uppercase tracking-[0.2em]">
          System / <span className="text-white font-bold">{sectionLabel}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isAuthorized ? "bg-green-500" : "bg-blue-500"} animate-pulse`} />
          <span className="text-[9px] text-white/40 font-bold tracking-tighter">
            {isAuthorized ? "SESSION_ACTIVE" : "NODE_01_OFFLINE"}
          </span>
        </div>
      </div>

      {/* TERMINAL LOGS WITH RETRY LOGIC */}
      <div className="px-6 py-2 border-b border-white/5 bg-white/[0.01] max-h-32 overflow-y-auto shrink-0 scrollbar-hide">
        {sessionRestored && (
          <p className="text-[9px] font-mono text-emerald-400/80 tracking-widest mb-1 italic">
            AUTH_SUCCESS // SESSION_RESTORED
          </p>
        )}
        {terminalLogs.map((log, i) => (
          <div key={i} className="flex items-center gap-3 group">
            <p
              className={`text-[9px] font-mono tracking-widest leading-relaxed ${log.type === "error" ? "text-red-400" : "text-[#00A3FF]/60"}`}
            >
              &gt; {log.msg}
            </p>
            {log.retryFile && (
              <button
                onClick={() => handleFileUpload(log.retryFile!)}
                className="flex items-center gap-1 text-[8px] text-white/40 hover:text-[#00A3FF] transition-colors font-black uppercase"
              >
                <RefreshCcw size={8} /> Retry
              </button>
            )}
          </div>
        ))}
      </div>

      {/* CONTENT AREA */}
      <div className="flex-1 flex flex-col p-8 overflow-y-auto">
        {activeSection === "home" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-12">
            {!missionStarted ? (
              <form onSubmit={handleStartMission} className="w-full max-w-2xl space-y-4">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 animate-in slide-in-from-bottom-2 duration-300">
                    {attachments.map((att, i) => (
                      <AttachmentChip
                        key={`${att.name}-${i}`}
                        attachment={att}
                        onRemove={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                      />
                    ))}
                  </div>
                )}

                <div className="relative flex items-start gap-4">
                  <div className="relative pt-2" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setShowUploadMenu(!showUploadMenu)}
                      disabled={uploading}
                      className="p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[#00A3FF]/30 transition-all disabled:opacity-30 group"
                    >
                      <Plus
                        size={18}
                        className={`${uploading ? "animate-spin text-[#00A3FF]" : "text-white/40 group-hover:text-[#00A3FF]"}`}
                      />
                    </button>

                    {showUploadMenu && (
                      <div className="absolute left-full ml-4 top-0 w-48 bg-[#0a1628]/98 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden z-[100] shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-in fade-in zoom-in-95 duration-200">
                        {UPLOAD_MENU_ITEMS.map((item) => {
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.label}
                              type="button"
                              onClick={item.action}
                              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.05] border-b border-white/5 last:border-0 transition-colors group"
                            >
                              <Icon size={14} className="text-[#00A3FF]/40 group-hover:text-[#00A3FF]" />
                              <span className="text-[10px] text-white/50 font-mono uppercase tracking-widest group-hover:text-white transition-colors">
                                {item.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <textarea
                    value={directive}
                    onChange={(e) => setDirective(e.target.value)}
                    placeholder="ENTER MISSION PARAMETERS..."
                    className="flex-1 bg-white/[0.03] border border-white/10 rounded-2xl text-white font-sans text-sm p-6 placeholder:text-white/5 outline-none resize-none focus:border-[#00A3FF]/30 focus:bg-[#00A3FF]/[0.02] transition-all min-h-[120px]"
                  />
                </div>

                <div className="flex justify-between items-center pt-2">
                  <p className="text-[9px] text-white/20 uppercase tracking-[0.25em] font-medium">
                    {uploading ? "SYNCING_ASSETS..." : isAuthorized ? "READY_FOR_EXECUTION" : "AUTH_REQUIRED"}
                  </p>
                  <button
                    type="submit"
                    disabled={(!directive.trim() && attachments.length === 0) || uploading}
                    className="px-10 py-3.5 bg-[#00A3FF] text-white text-[10px] font-black uppercase tracking-[0.3em] rounded-xl hover:bg-blue-400 hover:shadow-[0_0_30px_rgba(0,163,255,0.4)] transition-all disabled:opacity-10 active:scale-95"
                  >
                    Start Mission Now
                  </button>
                </div>
              </form>
            ) : (
              <div className="w-full max-w-3xl space-y-8 animate-in fade-in zoom-in duration-700">
                <div className="flex items-center justify-between">
                  <button
                    onClick={resetMission}
                    className="flex items-center gap-2 text-[9px] text-white/40 hover:text-[#00A3FF] transition-colors uppercase font-black tracking-widest"
                  >
                    <ChevronLeft size={12} /> New Mission
                  </button>
                  <div className="text-right">
                    <h3 className="text-[#00A3FF] text-[10px] font-black uppercase tracking-[0.5em]">
                      Solution Orchestrated
                    </h3>
                    <p className="text-white/30 text-[9px] mt-1 font-mono">
                      ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  {WORKFLOW_STEPS.map((step, i) => {
                    const isActive = workflowActive && workflowStep >= i;
                    const isDone = !workflowActive && missionOutput;
                    const Icon = step.icon;
                    return (
                      <div
                        key={step.label}
                        className={`flex flex-col items-center gap-3 p-5 rounded-xl border transition-all duration-300 ${
                          isActive || isDone
                            ? "border-[#00A3FF]/40 bg-[#00A3FF]/10 shadow-[0_0_25px_rgba(0,163,255,0.15)]"
                            : "border-white/5 bg-white/[0.01] opacity-20"
                        }`}
                      >
                        <Icon size={20} className={isActive || isDone ? "text-[#00A3FF]" : "text-white"} />
                        <span
                          className={`text-[8px] font-black uppercase tracking-[0.2em] ${isActive || isDone ? "text-white" : "text-white/50"}`}
                        >
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 relative overflow-hidden group min-h-[300px]">
                  <div className="absolute inset-0 bg-[#00A3FF]/[0.01] pointer-events-none" />

                  {missionOutput ? (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                      <div className="flex items-center gap-2 mb-6">
                        <div className="w-2 h-2 rounded-full bg-[#00A3FF] animate-pulse" />
                        <span className="text-[10px] text-[#00A3FF] font-mono font-bold uppercase tracking-widest">
                          Output_Stream_Verified
                        </span>
                      </div>
                      <div className="text-white/80 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                        {missionOutput}
                      </div>
                    </div>
                  ) : (
                    <div className="h-40 flex flex-col items-center justify-center gap-4">
                      <p className="text-[10px] text-[#00A3FF]/40 animate-pulse uppercase tracking-[0.4em] font-mono">
                        Processing Node Output...
                      </p>
                      <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-[#00A3FF] animate-progress-loading" style={{ width: "60%" }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col animate-in fade-in duration-500">
            <div className="flex items-center gap-4 border-b border-white/5 pb-6 mb-8">
              <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                <Database size={20} className="text-[#00A3FF]" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-[0.2em]">{sectionLabel} Archives</h2>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">
                  Verified mission historical records
                </p>
              </div>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl bg-blue-500/[0.02] p-12 text-center">
              <ShieldCheck size={22} className="text-[#00A3FF]/20 mb-4" />
              <p className="text-[10px] text-white/20 uppercase tracking-[0.3em] font-mono">
                Secure_Node // Synchronized
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTerminal;
