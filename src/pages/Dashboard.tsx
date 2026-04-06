import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogOut, Send, Loader2, Download, RefreshCw, Check, Palette, Zap, Coins, Archive } from "lucide-react";
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
import DecisionFork from "@/components/DecisionFork";
import BusinessTypeSelector from "@/components/BusinessTypeSelector";
import IdeaHelper from "@/components/IdeaHelper";
import CreditRefillModal from "@/components/CreditRefillModal";
import DashboardRecently from "@/pages/DashboardRecently";
import DashboardAllProjects from "@/pages/DashboardAllProjects";
import DashboardTrash from "@/pages/DashboardTrash";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SWIFT_SERVICE_URL = `${SUPABASE_URL}/functions/v1/swift-service`;

async function invokeSwiftService(body: Record<string, unknown>) {
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
    updateProjectHTML,
    trashProject,
    restoreProject,
    deleteProject,
  } = useProjects(user?.id);

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [generatedHTML, setGeneratedHTML] = useState("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showEditChat, setShowEditChat] = useState(false);
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [designChoice, setDesignChoice] = useState<string | null>(null);
  const [showDecisionFork, setShowDecisionFork] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "success">("idle");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();

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

  const cleanHTML = (raw: string): string => raw.replace(/```html|```/g, "").trim();

  const handleArchiveMission = async () => {
    if (!generatedHTML || saveState === "saving") return;
    setSaveState("saving");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");

      const { error } = await supabase.from("missions").insert({
        user_id: session.user.id,
        directive: generatedHTML,
        status: "completed",
      });

      if (error) throw error;

      setSaveState("success");
      toast({ title: "MISSION_ARCHIVED", description: "Successfully saved to the cloud." });
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
      const fullPrompt = `${prompt.trim()}. Style: ${designChoice === "minimal" ? "minimalist, clean" : "bold, vibrant"}.`;
      const data = await invokeSwiftService({ prompt: fullPrompt, userId: user?.id });
      const cleaned = cleanHTML(data.content || "");
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
  }, [prompt, isGenerating, credits, designChoice, user, deductCredit, refetchCredits, saveProject, toast]);

  const handleEdit = useCallback(
    async (message: string, chatHistory: any[]) => {
      if (isEditing) return;
      setIsEditing(true);
      try {
        const data = await invokeSwiftService({
          prompt: message,
          currentHTML: generatedHTML,
          chatHistory,
          userId: user?.id,
        });
        const cleaned = cleanHTML(data.content || "");
        setGeneratedHTML(cleaned);
        if (currentProjectId) await updateProjectHTML(currentProjectId, cleaned);
      } catch (e: any) {
        toast({ title: "Edit failed", description: e.message, variant: "destructive" });
      } finally {
        setIsEditing(false);
      }
    },
    [generatedHTML, isEditing, user, currentProjectId, updateProjectHTML, toast],
  );

  const handleDownload = () => {
    const blob = new Blob([generatedHTML], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazai-${Date.now()}.html`;
    a.click();
  };

  const sidebarContext: DashboardContext =
    showEditChat && generatedHTML ? "edit" : generatedHTML ? "preview" : "browse";

  return (
    <>
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background text-foreground">
          <DashboardSidebar
            context={sidebarContext}
            onAction={(action) => {
              if (action === "edit") setShowEditChat(true);
              if (action === "preview") setShowEditChat(false);
              if (action === "download") handleDownload();
            }}
            credits={credits}
            onRefillClick={() => setShowCreditModal(true)}
          />

          <div className="flex-1 flex flex-col">
            <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5">
              <div className="container mx-auto px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <SidebarTrigger className="hover:bg-white/10" />
                  <Logo size="md" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20">
                    <Coins className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold">{credits ?? "..."}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleLogout}>
                    <LogOut className="w-4 h-4 mr-2" /> Exit
                  </Button>
                </div>
              </div>
            </header>

            <main className="pt-24 pb-12 flex-1 flex flex-col container mx-auto px-6">
              {!showGenerator ? (
                <div className="flex-1">
                  {currentPath === "/dashboard/projects" ? (
                    <DashboardAllProjects
                      projects={activeProjects}
                      loading={projectsLoading}
                      onTrash={trashProject}
                      onOpenProject={handleOpenProject}
                    />
                  ) : currentPath === "/dashboard/trash" ? (
                    <DashboardTrash
                      projects={trashedProjects}
                      loading={projectsLoading}
                      onRestore={restoreProject}
                      onDelete={deleteProject}
                      onSaveToAll={restoreProject}
                      onOpenProject={handleOpenProject}
                    />
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
                      <div className="space-y-2 text-center">
                        <h2 className="text-3xl font-bold text-red-500">IS THIS WORKING??</h2>
                      </div>
                      <div className="flex gap-3 p-2 rounded-2xl bg-secondary/30 border border-white/5">
                        <Textarea
                          placeholder="Describe your site..."
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          className="min-h-[80px] bg-transparent border-none focus-visible:ring-0 resize-none text-lg"
                        />
                        <Button
                          variant="hero"
                          size="lg"
                          disabled={!prompt.trim()}
                          onClick={() => setShowDecisionFork(true)}
                        >
                          <Send className="w-5 h-5" />
                        </Button>
                      </div>
                      <IdeaHelper onSelectIdea={setPrompt} />
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col gap-4">
                      <div className="flex items-center justify-between glass p-3 rounded-xl border border-white/10 shadow-lg">
                        <div className="flex items-center gap-3">
                          {isGenerating ? (
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          ) : (
                            <Check className="w-4 h-4 text-green-500" />
                          )}
                          <span className="text-sm font-bold tracking-tight">
                            {isGenerating ? "ARCHITECTING..." : "DRAFT READY"}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          {/* UPDATED ARCHIVE BUTTON WITH FORCED VISIBILITY */}
                          {generatedHTML && (
                            <Button
                              variant="outline"
                              size="sm"
                              className={
                                saveState === "success"
                                  ? "bg-green-500/20 border-green-500 text-green-500"
                                  : "bg-primary/10 border-primary text-primary hover:bg-primary hover:text-black font-bold shadow-[0_0_15px_rgba(var(--primary),0.2)]"
                              }
                              onClick={handleArchiveMission}
                              disabled={saveState === "saving"}
                            >
                              {saveState === "saving" ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              ) : saveState === "success" ? (
                                <Check className="w-4 h-4 mr-2" />
                              ) : (
                                <Archive className="w-4 h-4 mr-2" />
                              )}
                              {saveState === "success" ? "ARCHIVED" : "ARCHIVE TO CLOUD"}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDownload}
                            disabled={!generatedHTML}
                            className="border-white/10"
                          >
                            <Download className="w-4 h-4 mr-2" /> Export
                          </Button>
                          <Button variant="hero" size="sm" onClick={handleNewWebsite}>
                            <RefreshCw className="w-4 h-4 mr-2" /> Reset
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 rounded-2xl border-4 border-black bg-white shadow-2xl overflow-hidden relative min-h-[60vh]">
                        {isGenerating && !generatedHTML ? (
                          <NeoSkeleton variant="preview" />
                        ) : (
                          <iframe srcDoc={generatedHTML} className="w-full h-full" title="Preview" />
                        )}
                      </div>
                      {generatedHTML && !isGenerating && (
                        <div className="animate-in slide-in-from-bottom-4 duration-500">
                          {showEditChat ? (
                            <EditChat onSendEdit={handleEdit} isGenerating={isEditing} />
                          ) : (
                            <NextStepSuggestions
                              onEdit={() => setShowEditChat(true)}
                              onPublish={() => {}}
                              onShare={() => {}}
                              onDownload={handleDownload}
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
      </SidebarProvider>

      {showDecisionFork && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-6">
          <div className="max-w-2xl w-full">
            <DecisionFork
              question="Choose a design aesthetic"
              options={[
                { label: "Minimalist", description: "Clean and professional.", icon: <Palette className="w-5 h-5" /> },
                { label: "Futuristic", description: "Bold and high-energy.", icon: <Zap className="w-5 h-5" /> },
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
    </>
  );
};

export default Dashboard;
