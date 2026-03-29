import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";

// Clean up AI markdown and wrap in a professional skeleton
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
      // FIXED: Calling the correct service name visible in your dashboard
      const { data, error: fnError } = await supabase.functions.invoke("swift-service", {
        body: { prompt: prompt.trim() },
      });

      if (fnError) throw new Error(fnError.message);
      
      const rawHTML = data?.html_code || data?.content || data?.code || "";
      if (!rawHTML) throw new Error("The AI didn't return any code. Try a different prompt.");

      const fullHTML = wrapInSkeleton(rawHTML);
      setGeneratedCode(fullHTML);

      // Open preview in new tab
      const blob = new Blob([fullHTML], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");

      if (user?.id) {
        await saveProject(prompt.slice(0, 50), fullHTML, prompt);
        fetchProjects();
      }
    } catch (err: any) {
      console.error("[NazAI Error]:", err);
      setError(err.message || "Failed to generate. Check your Supabase Secrets.");
    } finally {
      setLoading(false);
    }
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
          <label className="text-xs uppercase tracking-widest text-[#0ff]/60">Describe your business</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-white focus:outline-none focus:border-[#0ff]/50 transition-all"
            rows={4}
            placeholder="A futuristic landing page for a coffee shop..."
          />
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold bg-gradient-to-r from-[#0ff] to-[#f0f] text-black uppercase tracking-wider disabled:opacity-50"
          >
            <Zap className={loading ? "animate-pulse" : ""} />
            {loading ? "Generating..." : "Generate Website"}
          </button>
        </div>

        {error && <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5 text-red-400 text-sm">{error}</div>}

        <div className="relative bg-[#111] border border-white/5 rounded-xl overflow-hidden min-h-[400px]">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-[#0a0a0a]">
            <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500/60" /><div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" /><div className="w-2.5 h-2.5 rounded-full bg-green-500/60" /></div>
            <div className="flex-1 ml-3 px-3 py-1 rounded bg-white/5 text-[10px] text-white/20">naz-ai://preview</div>
          </div>
          {generatedCode ? (
            <iframe srcDoc={generatedCode} className="w-full h-[500px] bg-white" title="Preview" />
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center text-white/10">
              <Sparkles className="w-12 h-12 mb-4" />
              <p className="text-sm">Enter a prompt to start building...</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Generator;
