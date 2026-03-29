import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Zap, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Generator = () => {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [error, setError] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();

  const extractHTML = (text: string): string => {
    const match = text.match(/```html?\s*\n([\s\S]*?)```/);
    if (match) return match[1].trim();
    if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) return text.trim();
    return text;
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError("");
    setGeneratedCode("");

    try {
      // FIXED: Correct Function Name
      const { data, error: fnError } = await supabase.functions.invoke("naz-io-spark", {
        body: { prompt: prompt.trim() },
      });

      if (fnError) throw fnError;

      const raw = data?.content || data?.code || data?.html || "";
      if (!raw) throw new Error("No code returned from the AI.");

      const code = extractHTML(raw);
      setGeneratedCode(code);
    } catch (err: any) {
      console.error("[NazAI] ❌ Error:", err);
      setError(err.message || "Generation failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono relative overflow-hidden">
      {/* The Ambient Grid You Liked */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.015)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/50 backdrop-blur-md">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-sm text-white/50 hover:text-[#0ff] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#0ff]" />
          <span className="text-lg font-bold">
            Naz<span className="text-[#0ff]">AI</span> Generator
          </span>
        </div>
        <div className="w-16" />
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-10 flex flex-col gap-8">
        <div className="space-y-4">
          <label className="text-xs uppercase tracking-widest text-[#0ff]/60">Describe your website</label>
          <div className="relative group">
            <div className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-[#0ff] via-[#f0f] to-[#0ff] opacity-30 blur-sm" />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A dark-themed landing page..."
              rows={4}
              className="relative w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-5 py-4 text-white focus:outline-none focus:border-[#0ff]/50 transition-all"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="flex items-center gap-2 px-8 py-3 rounded-lg font-bold bg-gradient-to-r from-[#0ff] to-[#f0f] text-black uppercase tracking-wider hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
          >
            <Zap className={loading ? "animate-pulse" : ""} />
            {loading ? "Glitching..." : "Generate"}
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5 text-red-400 font-mono text-sm">
            {error}
          </div>
        )}

        {/* The Browser Chrome Preview You Liked */}
        <div className="relative bg-[#111] border border-white/5 rounded-xl overflow-hidden min-h-[500px]">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-[#0a0a0a]">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            </div>
            <div className="flex-1 ml-3 px-3 py-1 rounded bg-white/5 text-[11px] text-white/25">naz-ai://preview</div>
          </div>
          {generatedCode ? (
            <iframe srcDoc={generatedCode} className="w-full h-[500px] bg-white" title="Preview" />
          ) : (
            <div className="h-[500px] flex flex-col items-center justify-center text-white/10">
              <Sparkles className="w-12 h-12 mb-4" />
              <p className="font-mono text-sm">Waiting for prompt...</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Generator;
