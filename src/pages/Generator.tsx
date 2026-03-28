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
    // Try to extract HTML from markdown code fences
    const match = text.match(/```html?\s*\n([\s\S]*?)```/);
    if (match) return match[1].trim();
    // If already raw HTML, return as-is
    if (text.trim().startsWith("<!") || text.trim().startsWith("<html") || text.trim().startsWith("<head")) {
      return text.trim();
    }
    return text;
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError("");
    setGeneratedCode("");

    console.log("[NazAI] 🚀 Starting generation with prompt:", prompt.trim());

    try {
      console.log("[NazAI] 📡 Invoking swift-service edge function...");
      const { data, error: fnError } = await supabase.functions.invoke(
        "swift-service",
        {
          body: {
            prompt: prompt.trim(),
            userId: "00000000-0000-0000-0000-000000000000",
          },
        }
      );

      console.log("[NazAI] 📦 Response received:", { data, error: fnError });

      if (fnError) throw fnError;

      const raw = data?.content || data?.code || data?.html || "";
      console.log("[NazAI] 📝 Raw AI text length:", raw.length);

      if (!raw) throw new Error("No code returned from the AI.");

      const code = extractHTML(raw);
      console.log("[NazAI] ✅ Extracted HTML length:", code.length);

      setGeneratedCode(code);
    } catch (err: any) {
      console.error("[NazAI] ❌ Generation error:", err);
      setError(err.message || "Generation failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-[var(--font-display)]">
      {/* Ambient grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.015)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-sm text-white/50 hover:text-[#0ff] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#0ff]" />
          <span className="text-lg font-bold tracking-tight">
            Naz<span className="text-[#0ff]">AI</span>{" "}
            <span className="text-white/30 font-normal text-sm">Generator</span>
          </span>
        </div>
        <div className="w-16" />
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-10 flex flex-col gap-8">
        {/* Prompt section */}
        <div className="space-y-4">
          <label className="text-xs uppercase tracking-[0.25em] text-[#0ff]/60 font-mono">
            Describe your website
          </label>

          <div className="relative group">
            {/* Glow border */}
            <div className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-[#0ff] via-[#f0f] to-[#0ff] opacity-30 group-focus-within:opacity-70 blur-sm transition-opacity duration-500" />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A dark-themed landing page for an AI agency with a neon purple 'Get Started' button..."
              rows={4}
              className="relative w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-5 py-4 text-white placeholder:text-white/20 font-mono text-sm focus:outline-none focus:border-transparent resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
              }}
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className="relative group/btn flex items-center gap-2 px-8 py-3 rounded-lg font-bold text-sm uppercase tracking-wider transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: loading
                  ? "linear-gradient(135deg, #f0f, #0ff)"
                  : "linear-gradient(135deg, #0ff, #f0f)",
                color: "#0a0a0a",
              }}
            >
              {/* Button glow */}
              <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#0ff] to-[#f0f] opacity-0 group-hover/btn:opacity-40 blur-xl transition-opacity duration-500" />
              <Zap className={`w-4 h-4 ${loading ? "animate-pulse" : ""}`} />
              <span className="relative z-10">
                {loading ? "Glitching..." : "Generate"}
              </span>
            </button>

            <span className="text-xs text-white/20 font-mono">
              ⌘ + Enter
            </span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/5 text-red-400 text-sm font-mono">
            {error}
          </div>
        )}

        {/* Preview */}
        <div className="flex-1 min-h-[500px] relative">
          <label className="text-xs uppercase tracking-[0.25em] text-[#f0f]/60 font-mono mb-3 block">
            Live Preview
          </label>

          <div className="relative group/preview">
            {/* Preview glow */}
            <div className="absolute -inset-[1px] rounded-xl bg-gradient-to-br from-[#0ff]/20 via-transparent to-[#f0f]/20 opacity-50" />
            <div className="relative bg-[#111] border border-white/5 rounded-xl overflow-hidden">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-[#0a0a0a]">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                </div>
                <div className="flex-1 ml-3 px-3 py-1 rounded bg-white/5 text-[11px] text-white/25 font-mono truncate">
                  {generatedCode ? "naz-ai://generated-preview" : "naz-ai://waiting..."}
                </div>
              </div>

              {generatedCode ? (
                <iframe
                  ref={iframeRef}
                  srcDoc={generatedCode}
                  className="w-full h-[500px] bg-white"
                  sandbox="allow-scripts allow-same-origin"
                  title="Generated Website Preview"
                />
              ) : (
                <div className="w-full h-[500px] flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 rounded-2xl border border-white/5 bg-white/[0.02] flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-white/10" />
                  </div>
                  <p className="text-white/15 text-sm font-mono">
                    Your website will appear here
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Generator;
