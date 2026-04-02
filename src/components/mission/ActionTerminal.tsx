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

const ActionTerminal: React.FC<ActionTerminalProps> = ({ activeSection, initialDirective = "" }) => {
  const { user, loading } = useAuth();
  const { saveMission } = useMissions();
  const [directive, setDirective] = useState(initialDirective);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [workflowActive, setWorkflowActive] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(-1);
  const [missionStarted, setMissionStarted] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAuthorized = !!user;

  useEffect(() => {
    if (!loading && isAuthorized && !sessionRestored) {
      setSessionRestored(true);
    }
  }, [loading, isAuthorized, sessionRestored]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUploadMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const addLog = (msg: string) => {
    setTerminalLogs((prev) => [...prev, msg]);
  };

  const handleFileUpload = async (file: File) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    // 5MB Size Constraint
    if (file.size > 5 * 1024 * 1024) {
      addLog(`ERROR // ${file.name.toUpperCase()} // EXCEEDS_5MB_LIMIT`);
      return;
    }

    setUploading(true);
    addLog(`INITIALIZING_UPLOAD // ${file.name.toUpperCase()}...`);

    const fileExt = file.name.split(".").pop();
    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;

    try {
      const { error: uploadError } = await supabase.storage.from("mission-assets").upload(filePath, file);

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
      addLog(`UPLOAD_FAILED // ${err.message || "SERVER_REJECTION"}`);
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
      addLog("SCREENSHOT_ERROR // Could not capture");
    }
  };

  const handleRemoveAttachment = (index: number) => {
    const removed = attachments[index];
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    addLog(`FILE_REMOVED // ${removed.name}`);
  };

  const handleStartMission = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directive.trim() && attachments.length === 0) return;

    if (!isAuthorized) {
      sessionStorage.setItem("nazai_directive", directive);
      setShowAuthModal(true);
    } else {
      startWorkflow();
    }
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    startWorkflow();
  };

  const startWorkflow = () => {
    setMissionStarted(true);
    setWorkflowActive(true);
    setWorkflowStep(0);
    WORKFLOW_STEPS.forEach((_, i) => {
      setTimeout(
        () => {
          setWorkflowStep(i);
          if (i === WORKFLOW_STEPS.length - 1) {
            // Save mission to database on EXECUTION step
            const urls = attachments.map((a) => a.url);
            saveMission(directive, urls).then((result) => {
              if (result?.error) {
                addLog(`MISSION_SAVE_ERROR // ${result.error.message}`);
              } else {
                addLog("MISSION_PERSISTED // DATABASE_SYNC_COMPLETE");
              }
            });
            setTimeout(() => {
              setWorkflowActive(false);
              setWorkflowStep(-1);
            }, 1200);
          }
        },
        (i + 1) * 900,
      );
    });
  };

  const sectionLabel = SECTION_LABELS[activeSection] || "Home";

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
        addLog("HISTORY // No previous imports found");
      },
    },
    {
      label: "Connectors",
      icon: Link,
      action: () => {
        setShowUploadMenu(false);
        addLog("SYSTEM // EXTERNAL_BRIDGE_OFFLINE");
      },
    },
  ];

  return (
    <div className="flex-1 flex flex-col bg-[#020617] h-full selection:bg-blue-500/30 overflow-hidden relative">
      {!isAuthorized && (
        <AuthModal open={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} multiple />

      {/* ── HEADER ── */}
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

      {/* ── SESSION RESTORED ── */}
      {sessionRestored && (
        <div className="px-6 py-2 border-b border-white/5 bg-emerald-500/[0.04]">
          <p className="text-[10px] font-mono text-emerald-400/80 tracking-widest">AUTH_SUCCESS // SESSION_RESTORED</p>
        </div>
      )}

      {/* ── TERMINAL LOGS ── */}
      {terminalLogs.length > 0 && (
        <div className="px-6 py-2 border-b border-white/5 bg-white/[0.01] max-h-24 overflow-y-auto">
          {terminalLogs.map((log, i) => (
            <p key={i} className="text-[9px] font-mono text-[#00A3FF]/60 tracking-widest">
              &gt; {log}
            </p>
          ))}
        </div>
      )}

      {/* ── CONTENT AREA ── */}
      <div className="flex-1 flex flex-col p-8 overflow-y-auto">
        {activeSection === "home" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-12">
            {!missionStarted ? (
              <form onSubmit={handleStartMission} className="w-full max-w-2xl space-y-4">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((att, i) => (
                      <AttachmentChip
                        key={`${att.name}-${i}`}
                        attachment={att}
                        onRemove={() => handleRemoveAttachment(i)}
                      />
                    ))}
                  </div>
                )}

                <div className="relative flex items-start gap-3">
                  <div className="relative pt-5" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setShowUploadMenu(!showUploadMenu)}
                      disabled={uploading}
                      className="p-2.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[#00A3FF]/30 transition-all disabled:opacity-30"
                    >
                      <Plus size={16} className={`${uploading ? "animate-spin text-[#00A3FF]" : "text-white/40"}`} />
                    </button>

                    {showUploadMenu && (
                      <div className="absolute left-0 bottom-full mb-2 w-48 bg-[#0a1628]/95 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden z-50 shadow-2xl">
                        {UPLOAD_MENU_ITEMS.map((item) => {
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.label}
                              type="button"
                              onClick={item.action}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.05] transition-colors"
                            >
                              <Icon size={14} className="text-[#00A3FF]/60" />
                              <span className="text-[11px] text-white/60 font-mono uppercase tracking-wider">
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
                    rows={4}
                    className="flex-1 bg-white/[0.03] border border-white/10 rounded-2xl text-white font-sans text-sm p-6 placeholder:text-white/10 outline-none resize-none focus:border-blue-500/50 focus:bg-blue-500/[0.02] transition-all"
                  />
                </div>

                <div className="flex justify-between items-center">
                  <p className="text-[9px] text-white/20 uppercase tracking-[0.2em]">
                    {uploading
                      ? "Uploading asset..."
                      : isAuthorized
                        ? `Ready to execute${attachments.length > 0 ? ` • ${attachments.length} file${attachments.length > 1 ? "s" : ""} attached` : ""}`
                        : "Authentication required to execute"}
                  </p>
                  <button
                    type="submit"
                    disabled={(!directive.trim() && attachments.length === 0) || uploading}
                    className="px-8 py-3 bg-[#00A3FF] text-white text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl hover:bg-blue-400 hover:shadow-[0_0_20px_rgba(0,163,255,0.3)] transition-all disabled:opacity-20"
                  >
                    Start Mission Now
                  </button>
                </div>
              </form>
            ) : (
              <div className="w-full max-w-2xl space-y-8 animate-in fade-in zoom-in duration-700">
                <div className="text-center space-y-2">
                  <h3 className="text-[#00A3FF] text-[10px] font-black uppercase tracking-[0.4em]">
                    Solution Orchestrated
                  </h3>
                  <p className="text-white/60 text-xs italic">"{directive}"</p>
                  {attachments.length > 0 && (
                    <p className="text-[9px] text-white/30 uppercase tracking-widest">
                      {attachments.length} asset{attachments.length > 1 ? "s" : ""} linked
                    </p>
                  )}
                </div>

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
              <div className="w-14 h-14 rounded-full bg-white/[0.02] flex items-center justify-center mb-5 border border-white/5">
                <ShieldCheck size={22} className="text-[#00A3FF]/40" />
              </div>
              <p className="text-[11px] text-white/30 uppercase tracking-[0.25em] font-mono font-medium">
                Secure_Node // Synchronized
              </p>
              <p className="text-[9px] text-white/15 uppercase tracking-[0.2em] mt-2">No active records found</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTerminal;
