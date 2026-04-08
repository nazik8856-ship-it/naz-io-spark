import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogOut, Send, Loader2, Download, RefreshCw, Check, Palette, Zap, Coins, Archive, AlertTriangle, ChevronDown, Sparkles, Brain, Cpu, ZapOff } from "lucide-react";
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
  tier: "Standard" | "Pro" | "Experimental";
  category: AIModelCategory;
  isMediaMode?: boolean;
};

const CATEGORY_COLORS: Record<AIModelCategory, { neon: string; border: string; bg: string; text: string }> = {
  Logic:    { neon: "#00f0ff", border: "rgba(0,240,255,0.3)",   bg: "rgba(0,240,255,0.06)",   text: "text-cyan-400" },
  Creation: { neon: "#c084fc", border: "rgba(192,132,252,0.3)", bg: "rgba(192,132,252,0.06)", text: "text-purple-400" },
  Research: { neon: "#4ade80", border: "rgba(74,222,128,0.3)",  bg: "rgba(74,222,128,0.06)",  text: "text-green-400" },
};

const AVAILABLE_MODELS: AIModel[] = [
  // ── LOGIC (Cyan) ──────────────────────────────────────────────────────────
  {
    id: "google/gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    openRouterId: "google/gemini-3.1-pro",
    icon: <Zap className="w-4 h-4 text-cyan-400" />,
    description: "Best for complex business logic & 1M+ context.",
    role: "The Brain",
    tier: "Pro",
    category: "Logic",
  },
  {
    id: "anthropic/claude-4.6-sonnet",
    name: "Claude 4.6 Sonnet",
    openRouterId: "anthropic/claude-4.6-sonnet",
    icon: <Brain className="w-4 h-4 text-cyan-300" />,
    description: "Best for writing the actual code for the user's site.",
    role: "The Architect",
    tier: "Pro",
    category: "Logic",
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    openRouterId: "openai/gpt-5.4",
    icon: <Sparkles className="w-4 h-4 text-cyan-200" />,
    description: "Best all-rounder for marketing and research.",
    role: "The Manager",
    tier: "Pro",
    category: "Logic",
  },
  // ── CREATION (Purple) ─────────────────────────────────────────────────────
  {
    id: "google/gemini-3-flash-image",
    name: "Nano Banana 2.0",
    openRouterId: "google/gemini-3-flash-image",
    icon: <Palette className="w-4 h-4 text-purple-400" />,
    description: "Best for instant high-fidelity image/UI generation.",
    role: "The Designer",
    tier: "Experimental",
    category: "Creation",
    isMediaMode: true,
  },
  {
    id: "google/veo-3",
    name: "Google Veo 3",
    openRouterId: "google/veo-3",
    icon: <Zap className="w-4 h-4 text-purple-300" />,
    description: "State-of-the-art video generation model.",
    role: "The Filmmaker",
    tier: "Experimental",
    category: "Creation",
    isMediaMode: true,
  },
  {
    id: "elevenlabs/tts",
    name: "ElevenLabs Voice",
    openRouterId: "elevenlabs/tts",
    icon: <Cpu className="w-4 h-4 text-purple-200" />,
    description: "Ultra-realistic AI voice & audio generation.",
    role: "The Voice",
    tier: "Experimental",
    category: "Creation",
    isMediaMode: true,
  },
  // ── RESEARCH (Green) ──────────────────────────────────────────────────────
  {
    id: "x-ai/grok-4.20",
    name: "Grok 4.20",
    openRouterId: "x-ai/grok-4.20",
    icon: <Zap className="w-4 h-4 text-green-400" />,
    description: "Best for real-time news and viral content.",
    role: "The Trendsetter",
    tier: "Pro",
    category: "Research",
  },
  {
    id: "google/notebooklm",
    name: "NotebookLM",
    openRouterId: "google/notebooklm",
    icon: <Brain className="w-4 h-4 text-green-300" />,
    description: "Deep research synthesis from your documents.",
    role: "The Analyst",
    tier: "Standard",
    category: "Research",
  },
];;

async function invokeSwiftService(body: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase Configuration. Check Vercel Env Variables.");
  }

  const res = await fetch(SWIFT_SERVICE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
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
  const {
    activeProjects,
    trashedProjects,
    loading: projectsLoading,
    saveProject,
    trashProject,
    restoreProject,
    deleteProject,
  } = useProjects(user?.id);

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
  
  // AI Model Selection State
  const [selectedModel, setSelectedModel] = useState<AIModel>(AVAILABLE_MODELS[0]);
  const [isModelListOpen, setIsModelListOpen] = useState(false);

  const { toast } = useToast();

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error("CRITICAL: Supabase keys are missing!");
    }
  }, []);

  const currentPath = location.pathname;
  const isCreateRoute = currentPath === "/dashboard/create";
  const showGenerator = generatedHTML || isGenerating || isCreateRoute;

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const handleOpenProject = useCallback((project: Project) => {
    setGeneratedHTML(project.directive || "");
    setCurrentProjectId(project.id);
    setShowEditChat(false);
  }, []);

  const handleNewWebsite = useCallback(() => {
    setGeneratedHTML("");
    setPrompt("");
    setCurrentProjectId(null);
    setBusinessType(null);
    setShowDecisionFork(false);
    if (isCreateRoute) navigate("/dashboard");
  }, [isCreateRoute, navigate]);

  const handleArchiveMission = async () => {
    if (saveState === "saving" || !user) return;
    if (!generatedHTML) {
      toast({ title: "Nothing to save", description: "Generate a design first!", variant: "destructive" });
      return;
    }

    setSaveState("saving");
    try {
      const { error } = await supabase.from("missions").insert({
        user_id: user.id,
        directive: generatedHTML,
        status: "completed",
      });

      if (error) throw error;
      setSaveState("success");
      toast({ title: "MISSION_ARCHIVED", description: "Saved to cloud successfully." });
      setTimeout(() => setSaveState("idle"), 3000);
    } catch (e: any) {
      toast({ title: "Archive failed", description: e.message, variant: "destructive" });
      setSaveState("idle");
    }
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    if (credits !== null && credits <= 0) {
      setShowCreditModal(true);
      return;
    }

    setIsGenerating(true);
    setGeneratedHTML("");

    try {
      const fullPrompt = `${prompt.trim()}. Style: ${designChoice === "minimal" ? "minimalist" : "bold"}.`;
      
      const data = await invokeSwiftService({ 
        prompt: fullPrompt, 
        userId: user?.id,
        model: selectedModel.id 
      });
      
      const cleaned = (data.content || "").replace(/```html|```/g, "").trim();
      setGeneratedHTML(cleaned);

      const title = prompt.trim().slice(0, 50) || "Untitled Project";
      const newProj = await saveProject(title, cleaned, prompt.trim());
      if (newProj) setCurrentProjectId(newProj.id);

      await deductCredit();
      await refetchCredits();
    } catch (e: any) {
      toast({ title: "Generation error", description: e.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, credits, designChoice, user, selectedModel, deductCredit, refetchCredits, saveProject, toast]);

  const sidebarContext: DashboardContext =
    showEditChat && generatedHTML ? "edit" : generatedHTML ? "preview" : "browse";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background text-foreground font-sans relative overflow-x-hidden">
        <DashboardSidebar
          context={sidebarContext}
          onAction={(action) => {
            if (action === "edit") setShowEditChat(true);
            if (action === "preview") setShowEditChat(false);
            if (action === "download" && generatedHTML) {
              const blob = new Blob([generatedHTML], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `nazai-${Date.now()}.html`;
              a.click();
            }
          }}
          credits={credits}
          onRefillClick={() => setShowCreditModal(true)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="fixed top-0 left-0 right-0 z-[100] glass border-b border-white/5 bg-background/80 backdrop-blur-md">
            <div className="container mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <SidebarTrigger className="hover:bg-white/10" />
                <Logo size="md" />
              </div>
              
              <div className="flex items-center gap-4">
                {(!SUPABASE_URL || !SUPABASE_ANON_KEY) && (
                  <div className="flex items-center gap-1 text-red-500 animate-pulse mr-2 bg-red-500/10 p-2 rounded border border-red-500/20">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase">Auth Link Failed</span>
                  </div>
                )}
                
                <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20">
                  <Coins className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold">{credits ?? "..."}</span>
                </div>
                
                <Button
                  size="sm"
                  className={`font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all ${
                    saveState === "success" ? "bg-green-500 text-white" : "bg-emerald-500 text-white"
                  } active:shadow-none active:translate-x-1 active:translate-y-1`}
                  onClick={handleArchiveMission}
                  disabled={saveState === "saving" || !generatedHTML} 
                >
                  {saveState === "saving" ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : saveState === "success" ? (
                    <Check className="w-4 h-4 mr-2" />
                  ) : (
                    <Archive className="w-4 h-4 mr-2" />
                  )}
                  {saveState === "saving" ? "SYNCING..." : saveState === "success" ? "DONE!" : "SAVE TO CLOUD"}
                </Button>

                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-white/60 hover:text-white">
                  <LogOut className="w-4 h-4 mr-2" /> Exit
                </Button>
              </div>
            </div>
          </header>

          <main className="pt-24 pb-12 flex-1 flex flex-col container mx-auto px-6 relative z-10">
            {!showGenerator ? (
              <div className="flex-1">
                {currentPath === "/dashboard/projects" ? (
                  <DashboardAllProjects projects={activeProjects} loading={projectsLoading} onTrash={trashProject} onOpenProject={handleOpenProject} />
                ) : currentPath === "/dashboard/trash" ? (
                  <DashboardTrash projects={trashedProjects} loading={projectsLoading} onRestore={restoreProject} onDelete={deleteProject} onSaveToAll={restoreProject} onOpenProject={handleOpenProject} />
                ) : (
                  <DashboardRecently onOpenProject={handleOpenProject} />
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-6">
                {isCreateRoute && !businessType && !generatedHTML ? (
                  <BusinessTypeSelector onSelect={setBusinessType} />
                ) : !generatedHTML && !isGenerating ? (
                  <div className="max-w-3xl mx-auto w-full space-y-6">
                    <h2 className="text-3xl font-extrabold text-white text-center bg-black p-4 border-4 border-emerald-500 tracking-tighter uppercase">
                      Execute New Mission
                    </h2>
                    
                    <div className="flex gap-3 p-3 rounded-2xl bg-secondary/30 border border-white/5 shadow-2xl relative z-[60]">
                      
                      {/* AI MODEL SELECTOR */}
                      <div className="relative flex items-center">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setIsModelListOpen(!isModelListOpen)}
                          className={`h-full border-2 bg-black/40 hover:bg-black/60 flex flex-col items-center justify-center gap-1 min-w-[70px] ${isModelListOpen ? 'border-emerald-500' : 'border-primary/20'}`}
                        >
                          <div className="p-1 bg-primary/20 rounded-lg">
                            {selectedModel.icon}
                          </div>
                          <span className="text-[10px] font-black uppercase opacity-60">AI</span>
                        </Button>

                        {isModelListOpen && (
                          <div className="absolute bottom-full left-0 mb-4 w-72 bg-[#050a14] border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.8)] rounded-2xl overflow-hidden z-[200] animate-in fade-in slide-in-from-bottom-2">
                            <div className="p-3 border-b border-white/5">
                              <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Select Core Engine</h3>
                            </div>
                            <div className="p-2 space-y-3 max-h-[420px] overflow-y-auto">
                              {(["Logic", "Creation", "Research"] as AIModelCategory[]).map((cat) => {
                                const cc = CATEGORY_COLORS[cat];
                                const catModels = AVAILABLE_MODELS.filter((m) => m.category === cat);
                                return (
                                  <div key={cat}>
                                    <div className="flex items-center gap-2 px-2 py-1 mb-1">
                                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: cc.neon, boxShadow: `0 0 6px ${cc.neon}` }} />
                                      <span className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: cc.neon }}>{cat}</span>
                                    </div>
                                    {catModels.map((model) => (
                                      <button
                                        key={model.id}
                                        onClick={() => { setSelectedModel(model); setIsModelListOpen(false); }}
                                        className="w-full flex items-start gap-3 p-2.5 text-left rounded-xl transition-all mb-0.5"
                                        style={{
                                          background: selectedModel.id === model.id ? cc.bg : "transparent",
                                          border: `1px solid ${selectedModel.id === model.id ? cc.border : "transparent"}`,
                                        }}
                                      >
                                        <div className="mt-0.5 flex-shrink-0">{model.icon}</div>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-bold text-xs text-white">{model.name}</span>
                                            <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: cc.bg, color: cc.neon, border: `1px solid ${cc.border}` }}>
                                              {model.role}
                                            </span>
                                            {model.isMediaMode && (
                                              <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                                Media Generation Mode
                                              </span>
                                            )}
                                          </div>
                                          <p className="text-[10px] text-white/40 leading-tight mt-0.5 truncate">{model.description}</p>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <Textarea 
                        placeholder="Describe your site mission..." 
                        value={prompt} 
                        onChange={(e) => setPrompt(e.target.value)} 
                        className="min-h-[80px] bg-transparent border-none resize-none text-lg focus-visible:ring-0 flex-1 pt-4" 
                      />
                      
                      <Button 
                        variant="hero" 
                        size="lg" 
                        disabled={!prompt.trim() || isGenerating} 
                        onClick={() => setShowDecisionFork(true)}
                        className="self-center"
                      >
                        <Send className="w-5 h-5" />
                      </Button>
                    </div>
                    <IdeaHelper onSelectIdea={setPrompt} />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-4">
                    <div className="flex items-center justify-between glass p-4 rounded-xl border border-primary/30 shadow-2xl relative z-50">
                      <div className="flex items-center gap-3">
                        {isGenerating ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <Check className="w-5 h-5 text-green-500" />}
                        <div className="flex flex-col">
                          <span className="text-sm font-black uppercase tracking-widest leading-none">
                            {isGenerating ? "ARCHITECTING..." : "DRAFT READY"}
                          </span>
                          <span className="text-[10px] opacity-60 font-mono mt-1">ENGINE: {selectedModel.name.toUpperCase()}</span>
                        </div>
                      </div>
                      <Button variant="hero" size="sm" onClick={handleNewWebsite}>
                        <RefreshCw className="w-4 h-4 mr-2" /> Reset
                      </Button>
                    </div>

                    <div className="flex-1 rounded-2xl border-4 border-black bg-white shadow-2xl overflow-hidden relative min-h-[60vh] z-10">
                      {isGenerating && !generatedHTML ? (
                        <NeoSkeleton variant="preview" /> 
                      ) : (
                        <iframe 
                          srcDoc={generatedHTML} 
                          className="w-full h-full" 
                          title="Preview"
                        />
                      )}
                    </div>

                    {generatedHTML && !isGenerating && (
                      <div className="relative z-20">
                        {showEditChat ? (
                          <EditChat onSendEdit={async () => {}} isGenerating={false} /> 
                        ) : (
                          <NextStepSuggestions 
                            onEdit={() => setShowEditChat(true)} 
                            onPublish={() => {}}
                            onShare={() => {}}
                            onDownload={() => {}}
                            onNewWebsite={handleNewWebsite}
                            isPublished={false}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      {showDecisionFork && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-background/80 backdrop-blur-sm p-6">
          <div className="max-w-2xl w-full">
            <DecisionFork 
              question="Choose a design aesthetic" 
              options={[
                { label: "Minimalist", description: "Clean & Modern.", icon: <Palette className="w-5 h-5" /> },
                { label: "Futuristic", description: "Bold & High-Contrast.", icon: <Zap className="w-5 h-5" /> }
              ]} 
              onSelect={(i) => {
                setDesignChoice(i === 0 ? "minimal" : "bold");
                setShowDecisionFork(false);
                handleGenerate();
              }} 
            />
          </div>
        </div>
      )}
      <CreditRefillModal open={showCreditModal} onOpenChange={setShowCreditModal} userId={user?.id} />
    </SidebarProvider>
  );
};

export default Dashboard; 
