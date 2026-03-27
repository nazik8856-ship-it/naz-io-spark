import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef, useCallback } from "react";
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
  Copy,
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
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) token = data.session.access_token;
  } catch { /* use anon key as fallback */ }

  const res = await fetch(SWIFT_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Function failed with status ${res.status}`);
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
    fetchProjects,
  } = useProjects(user?.id);

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [generatedHTML, setGeneratedHTML] = useState("");
  const [streamingHTML, setStreamingHTML] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [showEditChat, setShowEditChat] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showWorkflowPreview, setShowWorkflowPreview] = useState(false);
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [designChoice, setDesignChoice] = useState<string | null>(null);
  const [showDecisionFork, setShowDecisionFork] = useState(false);
  const [showIdeaHelper, setShowIdeaHelper] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();

  // Which sub-view to show
  const currentPath = location.pathname;
  const isCreateRoute = currentPath === "/dashboard/create";
  const showGenerator = generatedHTML || streamingHTML || isGenerating || isCreateRoute;

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const handleOpenProject = useCallback((project: Project) => {
    setGeneratedHTML(project.html);
    setPrompt(project.prompt || "");
    setCurrentProjectId(project.id);
    setShareUrl(null);
    setPublishedUrl(null);
    setShowEditChat(false);
    // Update last_opened_at
    supabase.from("projects").update({ last_opened_at: new Date().toISOString() }).eq("id", project.id).then();
  }, []);

  const handleNewWebsite = useCallback(() => {
    setGeneratedHTML("");
    setStreamingHTML("");
    setPrompt("");
    setShareUrl(null);
    setCopied(false);
    setPublishedUrl(null);
    setShowEditChat(false);
    setCurrentProjectId(null);
    setDesignChoice(null);
    setShowDecisionFork(false);
    setShowWorkflowPreview(false);
  }, []);

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
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link copied!", description: "Shareable link copied to clipboard" });
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
      toast({ title: "Website published!", description: "Your website is now live." });
    } catch (e: any) {
      toast({ title: "Publish failed", description: e.message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [generatedHTML, isPublishing, toast]);

  const cleanHTML = (raw: string): string => {
    let cleaned = raw;
    if (cleaned.startsWith("```html")) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    return cleaned.trim();
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    if (credits !== null && credits <= 0) {
      setShowCreditModal(true);
      return;
    }

    setIsGenerating(true);
    setGeneratedHTML("");
    setStreamingHTML("");

    try {
      const fullPrompt = `${prompt.trim()}${designChoice ? `. Use a ${designChoice === "minimal" ? "minimal, clean, whitespace-driven" : "bold, dynamic, vivid"} design style.` : ""}`;
      
      const data = await invokeSwiftService({ prompt: fullPrompt, userId: "00000000-0000-0000-0000-000000000000" });
      if (data?.error) throw new Error(data.error);

      const cleaned = cleanHTML(data.content || '');
      setGeneratedHTML(cleaned);
      setStreamingHTML("");

      await deductCredit();

      // Save to websites table
      const title = prompt.trim().slice(0, 60) || "Untitled";
      await supabase.from('websites' as any).insert({
        title,
        html: cleaned,
        prompt: prompt.trim(),
        user_id: "00000000-0000-0000-0000-000000000000",
      });

    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, credits, designChoice, deductCredit, toast]);

  const handleEdit = useCallback(
    async (message: string, chatHistory: Array<{ role: string; content: string }>) => {
      if (isEditing) return;

      setIsEditing(true);
      setStreamingHTML("");

      try {
        const { data, error } = await supabase.functions.invoke('swift-service', {
          body: { prompt: message, currentHTML: generatedHTML, chatHistory, userId: "00000000-0000-0000-0000-000000000000" },
        });

        if (error) throw new Error(error.message || 'Edit failed');
        if (data?.error) throw new Error(data.error);

        const cleaned = cleanHTML(data.content || '');
        setGeneratedHTML(cleaned);
        setStreamingHTML("");

        if (currentProjectId) {
          await updateProjectHTML(currentProjectId, cleaned);
        }
      } catch (e: any) {
        toast({ title: "Edit failed", description: e.message || "Something went wrong", variant: "destructive" });
        throw e;
      } finally {
        setIsEditing(false);
      }
    },
    [generatedHTML, isEditing, toast, currentProjectId, updateProjectHTML],
  );

  const handleDownload = () => {
    const blob = new Blob([generatedHTML], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "website.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  const displayHTML = generatedHTML || streamingHTML;

  // Determine sidebar context
  const sidebarContext: DashboardContext = (() => {
    if (showEditChat && generatedHTML) return "edit";
    if (generatedHTML && !isGenerating) return "preview";
    if (isCreateRoute || prompt) return "prompt";
    return "browse";
  })();

  const handleSidebarAction = (action: string) => {
    switch (action) {
      case "idea-helper":
        setShowIdeaHelper(true);
        break;
      case "edit":
        setShowEditChat(true);
        break;
      case "preview":
        setShowEditChat(false);
        break;
      case "publish":
        handlePublish();
        break;
      case "share":
        handleShare();
        break;
      case "download":
        handleDownload();
        break;
    }
  };

  // Determine which sub-view to render
  const renderSubView = () => {
    if (showGenerator) return null; // Generator view takes over

    if (currentPath === "/dashboard/projects") {
      return (
        <DashboardAllProjects
          projects={activeProjects}
          loading={projectsLoading}
          onTrash={trashProject}
          onOpenProject={handleOpenProject}
        />
      );
    }
    if (currentPath === "/dashboard/trash") {
      return (
        <DashboardTrash
          projects={trashedProjects}
          loading={projectsLoading}
          onRestore={restoreProject}
          onDelete={deleteProject}
          onSaveToAll={restoreProject}
          onOpenProject={handleOpenProject}
        />
      );
    }

    // Default: Recently
    // Default: Recently
    return (
      <DashboardRecently
        onOpenProject={handleOpenProject}
      />
    );
  };

  return (
    <>
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background animate-dashboard-enter">
        <DashboardSidebar context={sidebarContext} onAction={handleSidebarAction} credits={credits} onRefillClick={() => setShowCreditModal(true)} />

        <div className="flex-1 flex flex-col">
          <header className="fixed top-0 left-0 right-0 z-50 glass">
            <div className="container mx-auto px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
                  <Logo size="md" linkTo="/" />
                </div>
                <div className="flex items-center gap-4">
                  {credits !== null && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass border border-border">
                      <Coins className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold">{credits}</span>
                      <span className="text-xs text-muted-foreground">credits</span>
                    </div>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <LogOut className="w-4 h-4" />
                        Log out
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="glass border-glow">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>You'll be signed out of NazAI.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>No, stay</AlertDialogCancel>
                        <AlertDialogAction onClick={handleLogout}>Yes, log out</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          </header>

          <main className="pt-24 pb-6 flex-1 flex flex-col">
            <div className="container mx-auto px-6 flex-1 flex flex-col">
              {!showGenerator || (isCreateRoute && !generatedHTML && !streamingHTML && !isGenerating) ? (
                <div className="flex-1 flex flex-col">
                  {/* Business type selector for create route (shown before prompt) */}
                  {isCreateRoute && !businessType && (
                    <div className="flex-1 flex items-center justify-center py-12">
                      <BusinessTypeSelector onSelect={(type) => setBusinessType(type)} />
                    </div>
                  )}

                  {/* Prompt bar visible after business type is chosen or on non-create routes */}
                  {(!isCreateRoute || businessType) && (
                    <>
                      <div className="max-w-2xl mx-auto w-full mb-8">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border-glow mb-4">
                          <Sparkles className="w-4 h-4 text-primary" />
                          <span className="text-sm text-muted-foreground">
                            {businessType ? `Building a ${businessType} website` : "AI Website Generator"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Textarea
                            placeholder={
                              businessType
                                ? `Describe your ${businessType} website...`
                                : "Describe the website you want to generate..."
                            }
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="min-h-[60px] bg-secondary/50 border-border resize-none text-sm"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) setShowDecisionFork(true);
                            }}
                          />
                          <Button
                            variant="hero"
                            size="lg"
                            onClick={() => setShowDecisionFork(true)}
                            disabled={!prompt.trim() || (credits !== null && credits <= 0)}
                            className="shrink-0"
                          >
                            <Send className="w-4 h-4" />
                          </Button>
                        </div>
                        <IdeaHelper
                          onSelectIdea={(idea) => {
                            setPrompt(idea);
                            setShowIdeaHelper(false);
                          }}
                        />
                      </div>

                      {/* Decision Fork: style choice */}
                      {showDecisionFork && !showWorkflowPreview && prompt.trim() && (
                        <div className="mb-8">
                          <DecisionFork
                            question="What design direction fits your vision?"
                            options={[
                              {
                                label: "Minimal & Clean",
                                description: "Whitespace-driven, elegant typography, subtle accents",
                                icon: <Palette className="w-5 h-5" />,
                              },
                              {
                                label: "Bold & Dynamic",
                                description: "Vivid colors, strong gradients, eye-catching animations",
                                icon: <Zap className="w-5 h-5" />,
                              },
                            ]}
                            onSelect={(i) => {
                              setDesignChoice(i === 0 ? "minimal" : "bold");
                              setShowDecisionFork(false);
                              setShowWorkflowPreview(true);
                            }}
                          />
                        </div>
                      )}

                      {/* Workflow preview card (Plan → Act → Reflect) */}
                      {showWorkflowPreview && prompt.trim() && (
                        <div className="mb-8">
                          <WorkflowPreview
                            prompt={`${prompt.trim()}${designChoice ? ` [Style: ${designChoice}]` : ""}`}
                            onApprove={() => {
                              setShowWorkflowPreview(false);
                              setShowDecisionFork(false);
                              handleGenerate();
                            }}
                            onCancel={() => {
                              setShowWorkflowPreview(false);
                              setShowDecisionFork(true);
                            }}
                            isGenerating={isGenerating}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {/* Sub-view content */}
                  {!isCreateRoute && renderSubView()}
                </div>
              ) : (
                <div className="flex-1 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {(isGenerating || isEditing) && (
                        <div className="flex items-center gap-2 text-primary">
                          <span className="text-sm font-bold uppercase tracking-wider">Building...</span>
                        </div>
                      )}
                      {generatedHTML && !isGenerating && !isEditing && (
                        <span className="text-sm text-muted-foreground">✓ Website generated</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {generatedHTML && (
                        <>
                          {!publishedUrl ? (
                            <Button variant="hero" size="sm" onClick={handlePublish} disabled={isPublishing}>
                              {isPublishing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Globe className="w-4 h-4" />
                              )}
                              {isPublishing ? "Publishing..." : "Publish"}
                            </Button>
                          ) : (
                            <a href={publishedUrl} target="_blank" rel="noopener noreferrer">
                              <Button variant="hero" size="sm" type="button">
                                <Globe className="w-4 h-4" />
                                View Live
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </a>
                          )}
                          <Button variant="outline" size="sm" onClick={handleShare} disabled={isSharing}>
                            {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                            {copied ? "Copied!" : "Share"}
                          </Button>
                          <Button variant="outline" size="sm" onClick={handleDownload}>
                            <Download className="w-4 h-4" />
                            Download
                          </Button>
                          <Button
                            variant={showEditChat ? "default" : "outline"}
                            size="sm"
                            onClick={() => setShowEditChat((v) => !v)}
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </Button>
                        </>
                      )}
                      <Button variant="heroOutline" size="sm" onClick={handleNewWebsite}>
                        <RefreshCw className="w-4 h-4" />
                        New Website
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 rounded-2xl overflow-hidden border-4 border-foreground bg-white min-h-[500px] relative">
                    {(isGenerating || isEditing) && !displayHTML && <NeoSkeleton variant="preview" />}
                    {displayHTML && (
                      <iframe
                        ref={iframeRef}
                        srcDoc={displayHTML}
                        className="w-full h-full min-h-[500px]"
                        sandbox="allow-scripts"
                        title="Generated Website Preview"
                      />
                    )}
                  </div>

                  {/* Next-step suggestions after generation */}
                  {generatedHTML && !isGenerating && !isEditing && !showEditChat && (
                    <NextStepSuggestions
                      onEdit={() => setShowEditChat(true)}
                      onPublish={handlePublish}
                      onShare={handleShare}
                      onDownload={handleDownload}
                      onNewWebsite={handleNewWebsite}
                      isPublished={!!publishedUrl}
                      onStrategyQuestion={(q) => {
                        setShowEditChat(true);
                        // Send strategy question through edit chat
                        setTimeout(() => {
                          const event = new CustomEvent("strategy-question", { detail: q });
                          window.dispatchEvent(event);
                        }, 100);
                      }}
                    />
                  )}

                  {generatedHTML && !isGenerating && showEditChat && (
                    <EditChat onSendEdit={handleEdit} isGenerating={isEditing} />
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
    <CreditRefillModal open={showCreditModal} onOpenChange={setShowCreditModal} userId={user?.id} />
    </>
  );
};

export default Dashboard;
