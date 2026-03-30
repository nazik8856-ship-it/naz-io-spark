import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Sparkles, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";

const wrapInSkeleton = (html: string) => {
  const clean = html.replace(/```html?\s*|```/gi, "").trim();
  if (clean.includes("<!DOCTYPE") || clean.includes("<html")) return clean;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="https://cdn.tailwindcss.com"></script><style>body { background: #0a0a0a; color: white; font-family: sans-serif; }</style></head><body>${clean}</body></html>`;
};

const Generator = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { saveProject, fetchProjects } = useProjects(user?.id);
  const [prompt, setPrompt] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("swift-service", {
        body: { prompt: prompt.trim() },
      });

      if (fnError) throw new Error(fnError.message);
      
      const rawHTML = data?.html_code || data?.content || data?.code || "";
      if (!rawHTML) throw new Error("The AI didn't return any code.");

      const fullHTML = wrapInSkeleton(rawHTML);
      setGeneratedCode(fullHTML);

      if (user?.id) {
        await saveProject(prompt.slice(0, 50), fullHTML, prompt);
        fetchProjects();
      }
    } catch (err: any) {
      setError(err.message || "Failed to generate.");
    } finally {
      setLoading(false);
    }
  };

  const downloadCode = () => {
    const blob = new Blob([generatedCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "index.html";
    a.click();
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono relative overflow-hidden">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.015)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />
      
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/50 backdrop-blur-md">
        <button onClick={() => navigate("/dashboard")} className="flex items-center gap-2 text-sm text-white/50 hover:text-[#0ff] transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#0ff]" />
          <span className="text-lg font-bold">Naz<span className="text-[#0ff]">AI</span></span>
        </div>
        <div className="w-16" />
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div className="space-y-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-white focus:outline-none focus:border-[#0ff]/50"
            rows={4}
            placeholder="Describe your vision..."
          />
          <div className="flex gap-4">
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold bg-gradient-to-r from-[#0ff] to-[#f0f] text-black uppercase tracking-wider"
            >
              <Zap className={loading ? "animate-pulse" : ""} />
              {loading ? "Generating..." : "Generate Website"}
            </button>
            {generatedCode && (
              <Button onClick={downloadCode} variant="outline" className="border-white/10 text-white">
                <Download className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>

        <div className="relative bg-[#111] border border-white/5 rounded-xl overflow-hidden min-h-[500px]">
          {generatedCode ? (
            <iframe srcDoc={generatedCode} className="w-full h-[600px] bg-white" title="Preview" />
          ) : (
            <div className="h-[500px] flex flex-col items-center justify-center text-white/10">
              <Sparkles className="w-12 h-12 mb-4" />
              <p>Your creation will appear here...</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Generator;