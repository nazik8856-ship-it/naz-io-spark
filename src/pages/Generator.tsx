 nazai-improvements
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";

// Strip markdown fences so the iframe renders clean HTML
function extractHTML(raw: string): string {
  return raw
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// Wrap partial snippets in a full HTML skeleton with Tailwind CDN
function wrapInSkeleton(html: string): string {
  const lower = html.toLowerCase();
  if (lower.includes("<!doctype") || lower.includes("<html")) {
    // Already a full document — just ensure Tailwind is present
    if (!lower.includes("tailwindcss")) {
      return html.replace(
        "</head>",
        `<script src="https://cdn.tailwindcss.com"></script>\n</head>`
      );
    }
    return html;
  }
  // Partial snippet — wrap it
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NazAI Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background: #0a0a0a; color: #f1f5f9; font-family: sans-serif; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}

const Generator = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { saveProject, fetchProjects } = useProjects(user?.id);

  const [prompt, setPrompt] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setGeneratedCode("");

    try {

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
 main
      const { data, error: fnError } = await supabase.functions.invoke("naz-io-spark", {
        body: { prompt: prompt.trim() },
      });

 nazai-improvements
      if (fnError) throw new Error(fnError.message);
      if (!data) throw new Error("No response from generator.");

      // Support both { html_code } and { content } response shapes
      const rawHTML: string = data.html_code ?? data.content ?? "";
      if (!rawHTML) throw new Error("Generator returned empty content.");

      const cleanHTML = extractHTML(rawHTML);
      const fullHTML = wrapInSkeleton(cleanHTML);

      setGeneratedCode(fullHTML);

      // Open in new tab immediately
      const blob = new Blob([fullHTML], { type: "text/html" });
      const blobURL = URL.createObjectURL(blob);
      window.open(blobURL, "_blank");

      // Save to project history in background (non-blocking)
      if (user?.id) {
        saveProject(
          prompt.trim().slice(0, 60),
          fullHTML,
          prompt.trim()
        ).then(() => {
          fetchProjects();
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);

      if (fnError) throw fnError;

      const raw = data?.content || data?.code || data?.html || "";
      if (!raw) throw new Error("No code returned from the AI.");

      const code = extractHTML(raw);
      setGeneratedCode(code);
    } catch (err: any) {
      console.error("[NazAI] ❌ Error:", err);
      setError(err.message || "Generation failed. Try again.");
      main
    } finally {
      setLoading(false);
    }
  };

  return (
    nazai-improvements
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: "#0a0a0a" }}
    >
      {/* Ambient cyan grid overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,255,0.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,255,0.015) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
        }}
      />

      {/* Glassmorphism Header */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4"
        style={{
          background: "rgba(10,10,10,0.7)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(0,255,255,0.08)",
        }}
      >
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-sm font-medium transition-colors"
          style={{ color: "rgba(255,255,255,0.5)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#00ffff")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h1
          className="text-lg font-bold tracking-tight"
          style={{
            background: "linear-gradient(90deg, #0ff, #f0f)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          NazAI Generator
        </h1>

        <div className="w-16" /> {/* spacer */}
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex flex-col items-center justify-start min-h-screen pt-28 pb-16 px-6">
        <div className="w-full max-w-3xl space-y-6">

          {/* Prompt Textarea */}
          <div className="space-y-2">
            <label
              htmlFor="prompt"
              className="text-xs uppercase tracking-widest font-medium"
              style={{ color: "rgba(0,255,255,0.6)" }}
            >
              Describe your business idea
            </label>
            <div
              className="rounded-xl p-px transition-all duration-300"
              style={{
                background: focused
                  ? "linear-gradient(135deg, #0ff, #f0f)"
                  : "rgba(255,255,255,0.08)",
              }}
            >
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
                placeholder="e.g. A landing page for a niche job board for climate tech startups..."
                rows={5}
                className="w-full rounded-xl px-5 py-4 text-sm resize-none outline-none"
                style={{
                  background: "#111111",
                  color: "#f1f5f9",
                  caretColor: "#0ff",
                }}
              />
            </div>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              Press Cmd/Ctrl + Enter to generate
            </p>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-xl font-bold text-sm uppercase tracking-widest transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: loading
                ? "rgba(0,255,255,0.1)"
                : "linear-gradient(135deg, #0ff 0%, #f0f 100%)",
              color: loading ? "#0ff" : "#0a0a0a",
              border: loading ? "1px solid rgba(0,255,255,0.3)" : "none",
              boxShadow: loading ? "none" : "0 0 32px rgba(0,255,255,0.25)",
            }}
          >
            {loading ? (
              <>
                <span
                  className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: "#0ff", borderTopColor: "transparent" }}
                />
                Glitching...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Generate
              </>
            )}
          </button>

          {/* Error */}
          {error && (
            <div
              className="rounded-xl px-5 py-4 text-sm"
              style={{
                background: "rgba(255,45,45,0.08)",
                border: "1px solid rgba(255,45,45,0.3)",
                color: "#ff6b6b",
              }}
            >
              {error}
            </div>
          )}

          {/* Browser Chrome Preview */}
          {generatedCode && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "rgba(0,255,255,0.6)" }}>
                Preview
              </p>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(0,255,255,0.12)" }}
              >
                {/* Browser chrome bar */}
                <div
                  className="flex items-center gap-2 px-4 py-3"
                  style={{ background: "#111111", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="w-3 h-3 rounded-full" style={{ background: "#ff5f57" }} />
                  <span className="w-3 h-3 rounded-full" style={{ background: "#febc2e" }} />
                  <span className="w-3 h-3 rounded-full" style={{ background: "#28c840" }} />
                  <div
                    className="ml-3 flex-1 rounded-md px-3 py-1 text-xs"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(255,255,255,0.3)",
                    }}
                  >
                    nazai://preview
                  </div>
                </div>
                {/* iframe */}
                <iframe
                  srcDoc={generatedCode}
                  className="w-full"
                  style={{ height: "520px", background: "#fff" }}
                  sandbox="allow-scripts allow-same-origin"
                  title="Generated Website Preview"
                />
              </div>
              <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.25)" }}>
                A new tab was opened with your site. The preview above is a local copy.
              </p>

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
 main
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Generator;
