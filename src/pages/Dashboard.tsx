import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LogOut,
  Sparkles,
  Send,
  Loader2,
  Download,
  RefreshCw,
  Share2,
  Check,
  Globe,
  ExternalLink,
  Pencil,
  Coins,
  Palette,
  Zap,
} from "lucide-react";
import NextStepSuggestions from "@/components/NextStepSuggestions";
import DecisionFork from "@/components/DecisionFork";
import WorkflowPreview from "@/components/WorkflowPreview";
import BusinessTypeSelector from "@/components/BusinessTypeSelector";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import EditChat from "@/components/EditChat";
import NeoSkeleton from "@/components/NeoSkeleton";
import Logo from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useProjects, type Project } from "@/hooks/useProjects";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar, type DashboardContext } from "@/components/DashboardSidebar";
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
    cache: "no-store",
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
    recentProjects,
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
  const [streamingHTML, setStreamingHTML] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [showEditChat, setShowEditChat] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showWorkflowPreview, setShowWorkflowPreview] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [designChoice, setDesignChoice] = useState<string | null>(null);
  const [showDecisionFork, setShowDecisionFork] = useState(false);
  const [showIdeaHelper, setShowIdeaHelper] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();

  const currentPath = location.pathname;
  const isCreateRoute = currentPath === "/dashboard/create";
  const showGenerator = generatedHTML || streamingHTML || isGenerating || isCreateRoute;

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const handleOpenProject = useCallback((project: Project) => {
    setGeneratedHTML(project.html);
    setPrompt("");
    setCurrentProjectId(project.id);
    setPublishedUrl(null);
    setShowEditChat(false);
    setShowDecisionFork(false);
    setShowWorkflowPreview(false);
  }, []);

  const handleEditPromptFromCard = useCallback((project: Project) => {
    setPrompt(project.prompt || "");
    setGeneratedHTML("");
    setCurrentProjectId(project.id);
    setShowEditChat(false);
  }, []);

  const handleNewWebsite = useCallback(() => {
    setGeneratedHTML("");
    setStreamingHTML("");
    setPrompt("");
    setCopied(false);
    setPublishedUrl(null);
    setShowEditChat(false);
    setCurrentProjectId(null);
    setDesignChoice(null);
    setBusinessType(null);
    setShowDecisionFork(false);
    setShowWorkflowPreview(false);
    if (isCreateRoute) navigate("/dashboard");
  }, [isCreateRoute, navigate]);

  const handleShare = useCallback(async () => {
    if (!generatedHTML || isSharing) return;
    setIsSharing(true);
    try {
      const { data, error } = await supabase
        .from("shared_websites")
        .insert({ html: generatedHTML })
        .select("id")
        .single();
      if (error) throw error;
      const url = `${window.location.origin}/share/${data.id}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link copied!", description: "Anyone with this link can view your site." });
    } catch (e: any) {
      toast({ title: "Share failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSharing(false);
    }
  }, [generatedHTML, isSharing, toast]);

  const handlePublish = useCallback(async () => {
    if (!generatedHTML || isPublishing) return;
    setIsPublishing(true);
    try {
      const { data, error } = await supabase
        .from("shared_websites")
        .insert({ html: generatedHTML })
        .select("id")
        .single();
      if (error) throw error;
      const url = `${window.location.origin}/share/${data.id}`;
      setPublishedUrl(url);
      toast({ title: "Site is Live!", description: "Your project has been published successfully." });
    } catch (e: any) {
      toast({ title: "Publish failed", description: e.message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [generatedHTML, isPublishing, toast]);

  const cleanHTML = (raw: string): string => {
    return raw.replace(/```html|```/g, "").trim();
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    if (credits !== null && credits <= 0) {
      setShowCreditModal(true);
      return;
    }

    const newTab = window.open("about:blank", "_blank");
    if (newTab) {
      newTab.document.write(`
        <body style="margin:0;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;font-family:sans-serif;">
          <div style="text-align:center">
            <h2 style="color:#00f2ff">NazAI is architecting your site...</h2>
            <p style="opacity:0.7">Applying ${designChoice || "modern"} styles</p>
          </div>
        </body>
      `);
    }

    setIsGenerating(true);
    setGeneratedHTML("");
    setGenerationError(null);

    try {
      const fullPrompt = `${prompt.trim()}. Style: ${designChoice === "minimal" ? "minimalist, clean" : "bold, vibrant"}.`;
      const data = await invokeSwiftService({ prompt: fullPrompt, userId: user?.id });

      const cleaned = cleanHTML(data.content || "");
      setGeneratedHTML(cleaned);

      if (newTab && !newTab.closed) {
        newTab.document.open();
        newTab.document.write(cleaned);
        newTab.document.close();
      }

      await deductCredit();
      await refetchCredits();

      const title = prompt.trim().slice(0, 50) || "Untitled Project";
      const { data: projData } = await supabase
        .from("websites")
        .insert({
          title,
          html: cleaned,
          prompt: prompt.trim(),
          user_id: user?.id,
        })
        .select()
        .single();

      if (projData) setCurrentProjectId(projData.id);
    } catch (e: any) {
      if (newTab) newTab.close();
      setGenerationError(e.message);
      toast({ title: "Generation error", description: e.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, credits, designChoice, user, deductCredit, refetchCredits, toast]);

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
    a.download = `nazai-project-${Date.now()}.html`;
    a.click();
  };

  const sidebarContext: DashboardContext =
    showEditChat && generatedHTML ? "edit" : generatedHTML ? "preview" : "browse";

  return (
    <>
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background animate-in fade-in duration-500">
          <DashboardSidebar
            context={sidebarContext}
            onAction={(action) => {
              if (action === "edit") setShowEditChat(true);
              if (action === "preview") setShowEditChat(false);
              if (action === "publish") handlePublish();
              if (action === "share") handleShare();
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
                  <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground">
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
                      onOpenProject={handleOpenProject}
                    />
                  ) : (
                    <DashboardRecently onOpenProject={handleOpenProject} onEditPrompt={handleEditPromptFromCard} />
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col gap-6">
                  {isCreateRoute && !businessType && !generatedHTML ? (
                    <BusinessTypeSelector onSelect={setBusinessType} />
                  ) : !generatedHTML && !isGenerating ? (
                    <div className="max-w-3xl mx-auto w-full space-y-6">
                      <div className="space-y-2">
                        <h2 className="text-2xl font-bold tracking-tight">Create something incredible</h2>
                        <p className="text-muted-foreground">Describe your vision, and NazAI will handle the code.</p>
                      </div>
                      <div className="flex gap-3 p-2 rounded-2xl bg-secondary/30 border border-white/5 shadow-2xl">
                        <Textarea
                          placeholder={
                            businessType
                              ? `Building your ${businessType} site...`
                              : "e.g. A dark portfolio for a designer..."
                          }
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          className="min-h-[80px] bg-transparent border-none focus-visible:ring-0 resize-none text-lg"
                        />
                        <Button
                          variant="hero"
                          size="lg"
                          className="h-auto px-6"
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
                      <div className="flex items-center justify-between glass p-3 rounded-xl border border-white/5">
                        <div className="flex items-center gap-3">
                          {isGenerating ? (
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          ) : (
                            <Check className="w-4 h-4 text-green-500" />
                          )}
                          <span className="text-sm font-medium">
                            {isGenerating ? "Processing AI logic..." : "Draft Complete"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={handleDownload} disabled={!generatedHTML}>
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
                          <iframe
                            ref={iframeRef}
                            srcDoc={generatedHTML}
                            className="w-full h-full"
                            sandbox="allow-scripts allow-same-origin allow-forms"
                            title="Preview"
                          />
                        )}
                      </div>
                      {generatedHTML && !isGenerating && (
                        <div className="animate-in slide-in-from-bottom-4 duration-500">
                          {showEditChat ? (
                            <EditChat onSendEdit={handleEdit} isGenerating={isEditing} />
                          ) : (
                            <NextStepSuggestions
                              onEdit={() => setShowEditChat(true)}
                              onPublish={handlePublish}
                              onShare={handleShare}
                              isPublished={!!publishedUrl}
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
                {
                  label: "Minimalist",
                  description: "Clean, fast, and professional.",
                  icon: <Palette className="w-5 h-5" />,
                },
                { label: "Futuristic", description: "Bold, neon, and high-energy.", icon: <Zap className="w-5 h-5" /> },
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
