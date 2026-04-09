import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogOut, Send, Loader2, Download, RefreshCw, Check, Palette, Zap, Coins, Archive, AlertTriangle, Plus, Sparkles, Brain, Cpu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useProjects, type Project } from "@/hooks/useProjects";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar, type DashboardContext } from "@/components/DashboardSidebar";
import Logo from "@/components/Logo";
import EditChat from "@/components/EditChat";
import NeoSkeleton from "@/components/NeoSkeleton";
import NextStepSuggestions from "@/components/NextStepSuggestions";
import BusinessTypeSelector from "@/components/BusinessTypeSelector";
import IdeaHelper from "@/components/IdeaHelper";
import DecisionFork from "@/components/DecisionFork";
import CreditRefillModal from "@/components/CreditRefillModal";
import DashboardRecently from "@/pages/DashboardRecently";
import DashboardAllProjects from "@/pages/DashboardAllProjects";
import DashboardTrash from "@/pages/DashboardTrash";

// --- CONFIGURATION ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SWIFT_SERVICE_URL = `${SUPABASE_URL}/functions/v1/swift-service`;

// --- AI MODELS DEFINITION ---
type AIModelCategory = "Logic" | "Creation" | "Research";
type AIModel = {
  id: string;
  name: string;
  openRouterId: string;
  icon: React.ReactNode;
  description: string;
  role: string;
  category: AIModelCategory;
  isMediaMode?: boolean;
};

const CATEGORY_META: Record<AIModelCategory, { neon: string; glow: string; label: string }> = {
  Logic:    { neon: "#00f0ff", glow: "rgba(0,240,255,0.15)", label: "Logic" },
  Creation: { neon: "#c084fc", glow: "rgba(192,132,252,0.15)", label: "Creation" },
  Research: { neon: "#4ade80", glow: "rgba(74,222,128,0.15)", label: "Research" },
};

const AVAILABLE_MODELS: AIModel[] = [
  { id: "google/gemini-3.1-pro", name: "Gemini 3.1 Pro", openRouterId: "google/gemini-3.1-pro", icon: <Zap className="w-4 h-4" />, description: "Best for complex business logic & 1M+ context.", role: "The Brain", category: "Logic" },
  { id: "anthropic/claude-4.6-sonnet", name: "Claude 4.6 Sonnet", openRouterId: "anthropic/claude-4.6-sonnet", icon: <Brain className="w-4 h-4" />, description: "Best for writing the actual code for the user's site.", role: "The Architect", category: "Logic" },
  { id: "openai/gpt-5.4", name: "GPT-5.4", openRouterId: "openai/gpt-5.4", icon: <Sparkles className="w-4 h-4" />, description: "Best all-rounder for marketing and research.", role: "The Manager", category: "Logic" },
  { id: "google/gemini-3-flash-image", name: "Nano Banana 2.0", openRouterId: "google/gemini-3-flash-image", icon: <Palette className="w-4 h-4" />, description: "Best for instant high-fidelity image/UI generation.", role: "The Designer", category: "Creation", isMediaMode: true },
  { id: "google/veo-3", name: "Google Veo 3", openRouterId: "google/veo-3", icon: <Zap className="w-4 h-4" />, description: "State-of-the-art video generation model.", role: "The Filmmaker", category: "Creation", isMediaMode: true },
  { id: "elevenlabs/lyria", name: "ElevenLabs Lyria", openRouterId: "elevenlabs/tts", icon: <Cpu className="w-4 h-4" />, description: "Ultra-realistic AI voice & audio generation.", role: "The Voice", category: "Creation", isMediaMode: true },
  { id: "google/notebooklm", name: "NotebookLM", openRouterId: "google/notebooklm", icon: <Brain className="w-4 h-4" />, description: "Deep research synthesis from your documents.", role: "The Analyst", category: "Research" },
  { id: "x-ai/grok-4.20", name: "Grok 4.20", openRouterId: "x-ai/grok-4.20", icon: <Zap className="w-4 h-4" />, description: "Best for real-time news and viral content.", role: "The Trendsetter", category: "Research" },
];

async function invokeSwiftService(body: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase Configuration. Check Vercel Env Variables.");
  }
  const res = await fetch(SWIFT_SERVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Service error: ${res.status}`);
  }
  return res.json();
}

const Dashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { credits, deductCredit, refetchCredits } = useCredits(user?.id);
  const { activeProjects, trashedProjects, loading: projectsLoading, saveProject, trashProject, restoreProject, deleteProject } = useProjects(user?.id);

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedHTML, setGeneratedHTML] = useState("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showEditChat, setShowEditChat] = useState(false);
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [designChoice, setDesignChoice] = useState<string | null>(null);
  const [showDecisionFork, setShowDecisionFork] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "success">("idle");
  const [selectedModel, setSelectedModel] = useState<AIModel>(AVAILABLE_MODELS[0]);
  const [isToolDrawerOpen, setIsToolDrawerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const currentPath = location.pathname;
  const isCreateRoute = currentPath === "/dashboard/create";
  const showGenerator = generatedHTML || isGenerating || isCreateRoute;
  const isMediaMode = selectedModel.isMediaMode === true;

  const handleLogout = async () => { await signOut(); navigate("/"); };

  const handleOpenProject = useCallback((project: Project) => {
    setGeneratedHTML(project.directive || "");
    setCurrentProjectId(project.id);
    setShowEditChat(false);
  }, []);

  const handleNewWebsite = useCallback(() => {
    setGeneratedHTML(""); setPrompt(""); setCurrentProjectId(null); setBusinessType(null); setShowDecisionFork(false);
    if (isCreateRoute) navigate("/dashboard");
  }, [isCreateRoute, navigate]);

  const handleArchiveMission = async () => {
    if (saveState === "saving" || !user || !generatedHTML) return;
    setSaveState("saving");
    try {
      const { error } = await supabase.from("missions").insert({ user_id: user.id, directive: generatedHTML, status: "completed" });
      if (error) throw error;
      setSaveState("success");
      toast({ title: "MISSION_ARCHIVED", description: "Saved to cloud successfully." });
      setTimeout(() => setSaveState("idle"), 3000);
    } catch (e: unknown) {
      toast({ title: "Archive failed", description: (e as Error).message, variant: "destructive" });
      setSaveState("idle");
    }
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    if (credits !== null && credits <= 0) { setShowCreditModal(true); return; }
    setIsGenerating(true); setGeneratedHTML("");
    try {
      const fullPrompt = `${prompt.trim()}. Style: ${designChoice === "minimal" ? "minimalist" : "bold"}.`;
      const data = await invokeSwiftService({ prompt: fullPrompt, userId: user?.id, model: selectedModel.id });
      const cleaned = (data.content || "").replace(/```html|```/g, "").trim();
      setGeneratedHTML(cleaned);
      const title = prompt.trim().slice(0, 50) || "Untitled Project";
      const newProj = await saveProject(title, cleaned, prompt.trim());
      if (newProj) setCurrentProjectId(newProj.id);
      await deductCredit(); await refetchCredits();
    } catch (e: unknown) {
      toast({ title: "Generation error", description: (e as Error).message, variant: "destructive" });
    } finally { setIsGenerating(false); }
  }, [prompt, isGenerating, credits, designChoice, user, selectedModel, deductCredit, refetchCredits, saveProject, toast]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  const displayName = user?.email?.split("@")[0] || "Operator";

  const sidebarContext: DashboardContext = showEditChat && generatedHTML ? "edit" : generatedHTML ? "preview" : "browse";

  // ─── Centered prompt view (Claude-style) ────────────────────────────
  const renderPromptView = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10 text-center"
      >
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
          <span className="text-white/90">{greeting}, </span>
          <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">{displayName}</span>
        </h1>
      </motion.div>

      {/* Main input card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="w-full max-w-2xl"
      >
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl shadow-[0_0_60px_rgba(0,0,0,0.4)] overflow-hidden">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && prompt.trim()) {
                e.preventDefault();
                setShowDecisionFork(true);
              }
            }}
            placeholder="Describe your system mission..."
            rows={3}
            className="w-full bg-transparent text-white/90 text-base placeholder:text-white/25 px-5 pt-5 pb-2 resize-none focus:outline-none"
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-4 pb-3 pt-1">
            {/* Left: + button */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsToolDrawerOpen(!isToolDrawerOpen)}
                className="w-8 h-8 rounded-full border border-white/10 hover:border-white/20 flex items-center justify-center transition-colors hover:bg-white/5"
              >
                {isToolDrawerOpen ? <X className="w-4 h-4 text-white/50" /> : <Plus className="w-4 h-4 text-white/50" />}
              </button>

              {/* Media mode badge */}
              <AnimatePresence>
                {isMediaMode && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8, x: -8 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: -8 }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border"
                    style={{
                      background: "rgba(192,132,252,0.1)",
                      borderColor: "rgba(192,132,252,0.3)",
                      color: "#c084fc",
                      boxShadow: "0 0 20px rgba(192,132,252,0.15)",
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                    Media Generation Mode
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* Right: model name + send */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsToolDrawerOpen(!isToolDrawerOpen)}
                className="text-xs text-white/40 hover:text-white/60 transition-colors flex items-center gap-1"
              >
                {selectedModel.name}
                <span className="text-[10px]">▾</span>
              </button>

              <button
                onClick={() => prompt.trim() && setShowDecisionFork(true)}
                disabled={!prompt.trim() || isGenerating}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-20"
                style={{
                  background: prompt.trim() ? "rgba(0,240,255,0.15)" : "transparent",
                  border: `1px solid ${prompt.trim() ? "rgba(0,240,255,0.3)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin text-cyan-400" /> : <Send className="w-4 h-4 text-cyan-400" />}
              </button>
            </div>
          </div>
        </div>

        {/* AI Tool Drawer */}
        <AnimatePresence>
          {isToolDrawerOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="overflow-hidden mt-3"
            >
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl p-4 space-y-4">
                {(["Logic", "Creation", "Research"] as AIModelCategory[]).map((cat) => {
                  const meta = CATEGORY_META[cat];
                  const models = AVAILABLE_MODELS.filter((m) => m.category === cat);
                  return (
                    <motion.div
                      key={cat}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: cat === "Logic" ? 0 : cat === "Creation" ? 0.05 : 0.1 }}
                    >
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: meta.neon, boxShadow: `0 0 8px ${meta.neon}` }} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: meta.neon }}>{meta.label}</span>
                      </div>
                      <div className="grid gap-1">
                        {models.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => { setSelectedModel(model); setIsToolDrawerOpen(false); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all group"
                            style={{
                              background: selectedModel.id === model.id ? meta.glow : "transparent",
                              border: `1px solid ${selectedModel.id === model.id ? `${meta.neon}33` : "transparent"}`,
                            }}
                          >
                            <div className="flex-shrink-0" style={{ color: meta.neon }}>{model.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-white/90">{model.name}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: meta.neon, background: `${meta.neon}15`, border: `1px solid ${meta.neon}25` }}>
                                  {model.role}
                                </span>
                              </div>
                              <p className="text-[10px] text-white/30 mt-0.5 truncate">{model.description}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Idea Helper below */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-8 w-full max-w-2xl"
      >
        <IdeaHelper onSelectIdea={setPrompt} />
      </motion.div>
    </div>
  );

  // ─── Preview / Generation view ─────────────────────────────────────
  const renderPreviewView = () => (
    <div className="flex-1 flex flex-col gap-4">
      <div className="flex items-center justify-between glass p-4 rounded-xl border border-primary/30 shadow-2xl relative z-50">
        <div className="flex items-center gap-3">
          {isGenerating ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <Check className="w-5 h-5 text-green-500" />}
          <div className="flex flex-col">
            <span className="text-sm font-black uppercase tracking-widest leading-none">{isGenerating ? "ARCHITECTING..." : "DRAFT READY"}</span>
            <span className="text-[10px] opacity-60 font-mono mt-1">ENGINE: {selectedModel.name.toUpperCase()}</span>
          </div>
        </div>
        <Button variant="hero" size="sm" onClick={handleNewWebsite}><RefreshCw className="w-4 h-4 mr-2" /> Reset</Button>
      </div>
      <div className="flex-1 rounded-2xl border-4 border-black bg-white shadow-2xl overflow-hidden relative min-h-[60vh] z-10">
        {isGenerating && !generatedHTML ? <NeoSkeleton variant="preview" /> : <iframe srcDoc={generatedHTML} className="w-full h-full" title="Preview" />}
      </div>
      {generatedHTML && !isGenerating && (
        <div className="relative z-20">
          {showEditChat ? (
            <EditChat onSendEdit={async () => {}} isGenerating={false} />
          ) : (
            <NextStepSuggestions onEdit={() => setShowEditChat(true)} onPublish={() => {}} onShare={() => {}} onDownload={() => {}} onNewWebsite={handleNewWebsite} isPublished={false} />
          )}
        </div>
      )}
    </div>
  );

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-[#020617] text-foreground font-sans relative overflow-x-hidden">
        <DashboardSidebar
          context={sidebarContext}
          onAction={(action) => {
            if (action === "edit") setShowEditChat(true);
            if (action === "preview") setShowEditChat(false);
            if (action === "download" && generatedHTML) {
              const blob = new Blob([generatedHTML], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `nazai-${Date.now()}.html`; a.click();
            }
          }}
          credits={credits}
          onRefillClick={() => setShowCreditModal(true)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="fixed top-0 left-0 right-0 z-[100] border-b border-white/[0.04] bg-[#020617]/80 backdrop-blur-xl">
            <div className="container mx-auto px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <SidebarTrigger className="hover:bg-white/10" />
                <Logo size="md" />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
                  <Coins className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-bold text-white/70">{credits ?? "..."}</span>
                </div>
                <Button
                  size="sm"
                  onClick={handleArchiveMission}
                  disabled={saveState === "saving" || !generatedHTML}
                  className="bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] text-white/70 text-xs font-medium"
                >
                  {saveState === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : saveState === "success" ? <Check className="w-3.5 h-3.5 mr-1.5 text-green-400" /> : <Archive className="w-3.5 h-3.5 mr-1.5" />}
                  {saveState === "saving" ? "Saving..." : saveState === "success" ? "Saved" : "Save"}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-white/30 hover:text-white/60 text-xs">
                  <LogOut className="w-3.5 h-3.5 mr-1.5" /> Exit
                </Button>
              </div>
            </div>
          </header>

          <main className="pt-16 pb-8 flex-1 flex flex-col container mx-auto px-6 relative z-10">
            {!showGenerator ? (
              <div className="flex-1">
                {currentPath === "/dashboard/projects" ? (
                  <DashboardAllProjects projects={activeProjects} loading={projectsLoading} onTrash={trashProject} onOpenProject={handleOpenProject} />
                ) : currentPath === "/dashboard/trash" ? (
                  <DashboardTrash projects={trashedProjects} loading={projectsLoading} onRestore={restoreProject} onDelete={deleteProject} onSaveToAll={restoreProject} onOpenProject={handleOpenProject} />
                ) : (
                  renderPromptView()
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-6">
                {isCreateRoute && !businessType && !generatedHTML ? (
                  <BusinessTypeSelector onSelect={setBusinessType} />
                ) : !generatedHTML && !isGenerating ? (
                  renderPromptView()
                ) : (
                  renderPreviewView()
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      {showDecisionFork && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[#020617]/90 backdrop-blur-sm p-6">
          <div className="max-w-2xl w-full">
            <DecisionFork
              question="Choose a design aesthetic"
              options={[
                { label: "Minimalist", description: "Clean & Modern.", icon: <Palette className="w-5 h-5" /> },
                { label: "Futuristic", description: "Bold & High-Contrast.", icon: <Zap className="w-5 h-5" /> },
              ]}
              onSelect={(i) => { setDesignChoice(i === 0 ? "minimal" : "bold"); setShowDecisionFork(false); handleGenerate(); }}
            />
          </div>
        </div>
      )}
      <CreditRefillModal open={showCreditModal} onOpenChange={setShowCreditModal} userId={user?.id} />
    </SidebarProvider>
  );
};

export default Dashboard;
