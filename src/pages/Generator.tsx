import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Sparkles, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import ModelSidebar from "@/components/ModelSidebar";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip markdown code fences so the iframe never breaks */
function extractHTML(raw: string): string {
  return raw
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** Ensure the output is a full HTML document with Tailwind CDN */
function wrapInSkeleton(html: string): string {
  const lower = html.toLowerCase();
  if (lower.includes("<!doctype") || lower.includes("<html")) {
    if (!lower.includes("tailwindcss")) {
      return html.replace(
        "</head>",
        `<script src="https://cdn.tailwindcss.com"></script>\n</head>`
      );
    }
    return html;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NazAI Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body { background: #0a0a0a; color: #f1f5f9; }</style>
</head>
<body>
${html}
</body>
</html>`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const Generator = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [prompt, setPrompt] = useState("");
  const [activeModel, setActiveModel] = useState("gemini-2.0-flash");
  const [thinkingModel, setThinkingModel] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setGeneratedCode("");
    setModelUsed(null);
    setThinkingModel(activeModel);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "naz-io-spark",
        {
          body: {
            prompt: prompt.trim(),
            model_choice: activeModel,
          },
        }
      );

      if (fnError) throw new Error(fnError.message);
      if (!data) throw new Error("No response from Neural Router.");

      const rawHTML: string = data.content ?? data.html_code ?? "";
      if (!rawHTML) throw new Error("Neural Router returned empty content.");

      const clean = extractHTML(rawHTML);
      const full = wrapInSkeleton(clean);

      setGeneratedCode(full);
      setModelUsed(data.model_used ?? activeModel);
      if (data.credits_remaining !== undefined) {
        setCreditsLeft(data.credits_remaining);
      }

      // Open in new tab
      const blob = new Blob([full], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setThinkingModel(null);
    }
  };

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "#020617", fontFamily: "system-ui, sans-serif" }}
    >
      {/* ── Ambient Grid ── */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,163,255,0.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,163,255,0.015) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
        }}
      />

      {/* ── Model Sidebar ── */}
      <div className="relative z-10 flex-shrink-0 h-full">
        <ModelSidebar
          activeModel={activeModel}
          onModelChange={setActiveModel}
          thinkingModel={thinkingModel}
        />
      </div>

      {/* ── Main Panel ── */}
      <div className="relative z-10 flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{
            background: "rgba(2,6,23,0.8)",
            backdropFilter: "blur(16px)",
            borderBottom: "1px solid rgba(0,163,255,0.08)",
          }}
        >
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "#00A3FF")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "rgba(255,255,255,0.4)")
            }
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: "#00A3FF" }} />
            <span
              className="text-base font-bold tracking-tight"
              style={{
                background: "linear-gradient(90deg, #00A3FF, #a855f7)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              NazAI Command Center
            </span>
          </div>

          <div className="flex items-center gap-3">
            {creditsLeft !== null && (
              <span
                className="text-xs px-2 py-1 rounded-md"
                style={{
                  background: "rgba(0,163,255,0.08)",
                  color: "#00A3FF",
                  border: "1px solid rgba(0,163,255,0.2)",
                }}
              >
                {creditsLeft} credits
              </span>
            )}
            {modelUsed && (
              <span
                className="text-xs px-2 py-1 rounded-md"
                style={{
                  background: "rgba(168,85,247,0.08)",
                  color: "#a855f7",
                  border: "1px solid rgba(168,85,247,0.2)",
                }}
              >
                {modelUsed.split("/").pop()}
              </span>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {/* Prompt area */}
          <div className="space-y-2">
            <label
              className="text-xs uppercase tracking-widest font-medium"
              style={{ color: "rgba(0,163,255,0.6)" }}
            >
              Mission Brief
            </label>

            <div
              className="rounded-xl p-px transition-all duration-300"
              style={{
                background: focused
                  ? "linear-gradient(135deg, #00A3FF, #a855f7)"
                  : "rgba(255,255,255,0.06)",
              }}
            >
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                    handleGenerate();
                }}
                placeholder="Describe the website or app you want to build..."
                rows={4}
                className="w-full rounded-xl px-5 py-4 text-sm resize-none outline-none"
                style={{
                  background: "#0a0f1e",
                  color: "#e2e8f0",
                  caretColor: "#00A3FF",
                }}
              />
            </div>

            <div className="flex items-center justify-between">
              <p
                className="text-xs"
                style={{ color: "rgba(255,255,255,0.2)" }}
              >
                Cmd/Ctrl + Enter to generate · Active model:{" "}
                <span style={{ color: "#00A3FF" }}>{activeModel}</span>
              </p>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-xl font-bold text-sm uppercase tracking-widest transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: loading
                ? "rgba(0,163,255,0.08)"
                : "linear-gradient(135deg, #00A3FF 0%, #a855f7 100%)",
              color: loading ? "#00A3FF" : "#020617",
              border: loading ? "1px solid rgba(0,163,255,0.3)" : "none",
              boxShadow: loading
                ? "none"
                : "0 0 32px rgba(0,163,255,0.2)",
            }}
          >
            {loading ? (
              <>
                <span
                  className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                  style={{
                    borderColor: "#00A3FF",
                    borderTopColor: "transparent",
                  }}
                />
                Glitching...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Execute Mission
              </>
            )}
          </button>

          {/* Error */}
          {error && (
            <div
              className="rounded-xl px-5 py-4 text-sm"
              style={{
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.25)",
                color: "#f87171",
              }}
            >
              {error}
            </div>
          )}

          {/* Browser Chrome Preview */}
          {generatedCode && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p
                  className="text-xs uppercase tracking-widest font-medium"
                  style={{ color: "rgba(0,163,255,0.6)" }}
                >
                  Live Preview
                </p>
                <button
                  onClick={() => {
                    const blob = new Blob([generatedCode], {
                      type: "text/html",
                    });
                    window.open(URL.createObjectURL(blob), "_blank");
                  }}
                  className="flex items-center gap-1 text-xs transition-colors"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "#00A3FF")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "rgba(255,255,255,0.3)")
                  }
                >
                  <ExternalLink className="w-3 h-3" />
                  Open in new tab
                </button>
              </div>

              <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(0,163,255,0.1)" }}
              >
                {/* Browser chrome bar */}
                <div
                  className="flex items-center gap-2 px-4 py-2.5"
                  style={{
                    background: "#080d1a",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <div className="flex gap-1.5">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: "rgba(239,68,68,0.6)" }}
                    />
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: "rgba(234,179,8,0.6)" }}
                    />
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: "rgba(34,197,94,0.6)" }}
                    />
                  </div>
                  <div
                    className="ml-3 flex-1 rounded px-3 py-1 text-[11px]"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(255,255,255,0.2)",
                    }}
                  >
                    nazai://preview · {activeModel}
                  </div>
                </div>
                <iframe
                  srcDoc={generatedCode}
                  className="w-full"
                  style={{ height: "520px", background: "#fff" }}
                  sandbox="allow-scripts allow-same-origin"
                  title="Generated Website Preview"
                />
              </div>
            </div>
          )}

          {/* Empty state */}
          {!generatedCode && !loading && (
            <div
              className="flex flex-col items-center justify-center py-24 rounded-xl"
              style={{ border: "1px dashed rgba(0,163,255,0.08)" }}
            >
              <Sparkles
                className="w-10 h-10 mb-4"
                style={{ color: "rgba(0,163,255,0.2)" }}
              />
              <p
                className="text-sm font-medium"
                style={{ color: "rgba(255,255,255,0.15)" }}
              >
                Select a model and enter a mission brief
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Generator;
