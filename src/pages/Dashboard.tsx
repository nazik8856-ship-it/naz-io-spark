import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogOut, Sparkles, Send, Loader2, Download, RefreshCw, Share2, Check, Copy, Globe, ExternalLink, Pencil, Coins } from "lucide-react";
import NextStepSuggestions from "@/components/NextStepSuggestions";
import WorkflowPreview from "@/components/WorkflowPreview";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
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
import { DashboardSidebar } from "@/components/DashboardSidebar";
import DashboardRecently from "@/pages/DashboardRecently";
import DashboardAllProjects from "@/pages/DashboardAllProjects";
import DashboardTrash from "@/pages/DashboardTrash";

const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-website`;

const Dashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading, signOut } = useAuth();
  const { credits, deductCredit, refetchCredits } = useCredits(user?.id);
  const {
    recentProjects, activeProjects, trashedProjects, loading: projectsLoading,
    saveProject, updateProjectHTML, trashProject, restoreProject, deleteProject, fetchProjects,
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();

  // Which sub-view to show
  const currentPath = location.pathname;
  const isCreateRoute = currentPath === "/dashboard/create";
  const showGenerator = generatedHTML || streamingHTML || isGenerating || isCreateRoute;

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [authLoading, user, navigate]);

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
  }, []);

  const handleShare = useCallback(async () => {
    if (!generatedHTML || isSharing) return;
    setIsSharing(true);
    try {
      const { data, error } = await supabase.from("shared_websites").insert({ html: generatedHTML }).select("id").single();
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
      const { data, error } = await supabase.from("shared_websites").insert({ html: generatedHTML }).select("id").single();
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

  const processStream = async (resp: Response): Promise<string> => {
    if (!resp.body) throw new Error("No response stream");
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullHTML = "";
    let done = false;

    while (!done) {
      const { done: readerDone, value } = await reader.read();
      if (readerDone) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") { done = true; break; }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) { fullHTML += content; setStreamingHTML(fullHTML); }
        } catch { buffer = line + "\n" + buffer; break; }
      }
    }

    let cleaned = fullHTML;
    if (cleaned.startsWith("```html")) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    return cleaned.trim();
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    if (credits !== null && credits <= 0) {
      toast({ title: "No credits left", description: "You've used all your credits.", variant: "destructive" });
      return;
    }

    const success = await deductCredit();
    if (!success) {
      toast({ title: "No credits left", description: "You've used all your credits.", variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    setGeneratedHTML("");
    setStreamingHTML("");

    try {
      const session = await supabase.auth.getSession();
      const resp = await fetch(GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.data.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to generate website");
      }

      const cleaned = await processStream(resp);
      setGeneratedHTML(cleaned);
      setStreamingHTML("");

      // Save as a new project
      const title = prompt.trim().slice(0, 60) || "Untitled Project";
      const saved = await saveProject(title, cleaned, prompt.trim());
      if (saved) setCurrentProjectId(saved.id);
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, credits, deductCredit, toast, saveProject]);

  const handleEdit = useCallback(async (message: string, chatHistory: Array<{role: string, content: string}>) => {
    if (isEditing) return;

    if (credits !== null && credits <= 0) {
      toast({ title: "No credits left", description: "You've used all your credits.", variant: "destructive" });
      return;
    }
    const success = await deductCredit();
    if (!success) {
      toast({ title: "No credits left", description: "You've used all your credits.", variant: "destructive" });
      return;
    }

    setIsEditing(true);
    setStreamingHTML("");

    try {
      const session = await supabase.auth.getSession();
      const resp = await fetch(GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.data.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ prompt: message, currentHTML: generatedHTML, chatHistory }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to edit website");
      }

      const cleaned = await processStream(resp);
      setGeneratedHTML(cleaned);
      setStreamingHTML("");

      // Update the project in DB
      if (currentProjectId) {
        await updateProjectHTML(currentProjectId, cleaned);
      }
    } catch (e: any) {
      toast({ title: "Edit failed", description: e.message || "Something went wrong", variant: "destructive" });
      throw e;
    } finally {
      setIsEditing(false);
    }
  }, [generatedHTML, isEditing, credits, deductCredit, toast, currentProjectId, updateProjectHTML]);

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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-12">
        <NeoSkeleton variant="card" className="max-w-md w-full" />
      </div>
    );
  }

  // Determine which sub-view to render
  const renderSubView = () => {
    if (showGenerator) return null; // Generator view takes over

    if (currentPath === "/dashboard/projects") {
      return <DashboardAllProjects projects={activeProjects} loading={projectsLoading} onTrash={trashProject} onOpenProject={handleOpenProject} />;
    }
    if (currentPath === "/dashboard/trash") {
      return <DashboardTrash projects={trashedProjects} loading={projectsLoading} onRestore={restoreProject} onDelete={deleteProject} onSaveToAll={restoreProject} onOpenProject={handleOpenProject} />;
    }
    // Default: Recently
    return <DashboardRecently projects={recentProjects} loading={projectsLoading} onTrash={trashProject} onOpenProject={handleOpenProject} />;
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background animate-dashboard-enter">
        <DashboardSidebar />

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
              {!showGenerator || isCreateRoute && !generatedHTML && !streamingHTML && !isGenerating ? (
                <div className="flex-1 flex flex-col">
                  {/* Prompt bar always visible */}
                  <div className="max-w-2xl mx-auto w-full mb-8">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border-glow mb-4">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="text-sm text-muted-foreground">AI Website Generator</span>
                    </div>
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Describe the website you want to generate..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        className="min-h-[60px] bg-secondary/50 border-border resize-none text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                      />
                      <Button variant="hero" size="lg" onClick={handleGenerate} disabled={!prompt.trim() || (credits !== null && credits <= 0)} className="shrink-0">
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

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
                              {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
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
                          <Button variant={showEditChat ? "default" : "outline"} size="sm" onClick={() => setShowEditChat((v) => !v)}>
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
                    {(isGenerating || isEditing) && !displayHTML && (
                      <NeoSkeleton variant="preview" />
                    )}
                    {displayHTML && (
                      <iframe ref={iframeRef} srcDoc={displayHTML} className="w-full h-full min-h-[500px]" sandbox="allow-scripts" title="Generated Website Preview" />
                    )}
                  </div>

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
  );
};

export default Dashboard;
