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
      const { data, error: fnError } = await supabase.functions.invoke("naz-io-spark", {
        body: { prompt: prompt.trim() },
      });

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
    } finally {
      setLoading(false);
    }
  };

  return (
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
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Generator;
