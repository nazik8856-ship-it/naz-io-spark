import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { LogOut, Sparkles, Send, Loader2, Download, RefreshCw, Share2, Check, Copy, Globe, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import EditChat from "@/components/EditChat";
import Logo from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";

const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-website`;

const Dashboard = () => {
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();

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
      console.error(e);
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
      console.error(e);
      toast({ title: "Publish failed", description: e.message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [generatedHTML, isPublishing, toast]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setGeneratedHTML("");
    setStreamingHTML("");

    try {
      const resp = await fetch(GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to generate website");
      }

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
          if (jsonStr === "[DONE]") {
            done = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              fullHTML += content;
              setStreamingHTML(fullHTML);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Clean up any markdown fences the model might add
      let cleaned = fullHTML;
      if (cleaned.startsWith("```html")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      setGeneratedHTML(cleaned);
      setStreamingHTML("");
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Generation failed",
        description: e.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, toast]);

  const handleEdit = useCallback(async (message: string, chatHistory: Array<{role: string, content: string}>) => {
    if (isEditing) return;
    setIsEditing(true);
    setStreamingHTML("");

    try {
      const resp = await fetch(GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          prompt: message,
          currentHTML: generatedHTML,
          chatHistory,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to edit website");
      }
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
      cleaned = cleaned.trim();

      setGeneratedHTML(cleaned);
      setStreamingHTML("");
    } catch (e: any) {
      console.error(e);
      toast({ title: "Edit failed", description: e.message || "Something went wrong", variant: "destructive" });
      throw e;
    } finally {
      setIsEditing(false);
    }
  }, [generatedHTML, isEditing, toast]);

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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Logo size="md" linkTo="/" />
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <LogOut className="w-4 h-4" />
                Log out
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 pb-6 flex-1 flex flex-col">
        <div className="container mx-auto px-6 flex-1 flex flex-col">
          {/* If no generated content yet, show centered prompt */}
          {!displayHTML && !isGenerating ? (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border-glow mb-6">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">AI Website Generator</span>
              </div>

              <h1 className="text-3xl md:text-4xl font-bold text-center mb-3">
                Describe your <span className="text-gradient">website</span>
              </h1>
              <p className="text-muted-foreground text-center mb-8 max-w-lg">
                Enter a prompt describing the website you want and we'll generate a fully designed, ready-to-use page instantly.
              </p>

              <div className="w-full space-y-4">
                <Textarea
                  placeholder="e.g., A modern SaaS landing page for a project management tool with dark theme, pricing section, testimonials, and a hero with gradient background..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[140px] bg-secondary/50 border-border resize-none text-base"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                  }}
                />
                <Button
                  variant="hero"
                  size="xl"
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  className="w-full"
                >
                  <Sparkles className="w-5 h-5" />
                  Generate Website
                  <Send className="w-5 h-5" />
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Press Ctrl+Enter to generate • Powered by AI
                </p>
              </div>
            </div>
          ) : (
            /* Generated content view */
            <div className="flex-1 flex flex-col gap-4">
              {/* Toolbar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isGenerating && (
                    <div className="flex items-center gap-2 text-primary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm font-medium">Generating...</span>
                    </div>
                  )}
                  {generatedHTML && !isGenerating && (
                    <span className="text-sm text-muted-foreground">✓ Website generated</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {generatedHTML && (
                    <>
                      <Button variant="outline" size="sm" onClick={handleShare} disabled={isSharing}>
                        {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                        {copied ? "Copied!" : "Share"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDownload}>
                        <Download className="w-4 h-4" />
                        Download
                      </Button>
                    </>
                  )}
                  <Button
                    variant="heroOutline"
                    size="sm"
                    onClick={() => {
                      setGeneratedHTML("");
                      setStreamingHTML("");
                      setPrompt("");
                      setShareUrl(null);
                      setCopied(false);
                    }}
                  >
                    <RefreshCw className="w-4 h-4" />
                    New Website
                  </Button>
                </div>
              </div>

              {/* Preview iframe */}
              <div className="flex-1 rounded-2xl overflow-hidden border border-border bg-white min-h-[500px]">
                <iframe
                  ref={iframeRef}
                  srcDoc={displayHTML}
                  className="w-full h-full min-h-[500px]"
                  sandbox="allow-scripts"
                  title="Generated Website Preview"
                />
              </div>

              {/* Edit chat - only show after generation is complete */}
              {generatedHTML && !isGenerating && (
                <EditChat onSendEdit={handleEdit} isGenerating={isEditing} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
