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
      return html.replace("</head>", `<script src="https://cdn.tailwindcss.com"></script>\n</head>`);
    }
    return html;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NazAI Preview</title>
  <script src="[https://cdn.tailwindcss.com](https://cdn.tailwindcss.com)"></script>
  <style>
    body { background: #0a0a0a; color: #f1f5f9; margin: 0; padding: 0; overflow-x: hidden; }
  </style>
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
  const [activeModel, setActiveModel] = useState("google/gemini-2.0-flash-001"); // Updated to OpenRouter format
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
      const { data, error: fnError } = await supabase.functions.invoke("naz-io-spark", {
        body: {
          prompt: prompt.trim(),
          model_choice: activeModel,
        },
      });

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

      // Open in new tab automatically
      const blob = new Blob([full], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setThinkingModel(null);
    }
  };

  return (
    <div
      className="flex h-screen w-full overflow-hidden"
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

      {/* ── Model Sidebar (Force Width + High Z-Index) ── */}
      <aside className="relative z-50 flex-shrink-0 h-full border-r border-white/5" style={{ minWidth: "260px" }}>
        <ModelSidebar activeModel={activeModel} onModelChange={setActiveModel} thinkingModel={thinkingModel} />
      </aside>

      {/* ── Main Panel ── */}
      <main className="relative z-10 flex flex-col flex-1 min-w-0 overflow-hidden bg-transparent">
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
            className="flex items-center gap-2 text-sm text-white/40 hover:text-[#00A3FF] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Exit Command Center
          </button>

          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#00A3FF]" />
            <span
              className="text-base font-black tracking-tighter uppercase"
              style={{
                background: "linear-gradient(90deg, #00A3FF, #a855f7)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              NazAI // V2.0
            </span>
          </div>

          <div className="flex items-center gap-3">
            {creditsLeft !== null && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-[#00A3FF]/10 text-[#00A3FF] border border-[#00A3FF]/20">
                {creditsLeft.toFixed(2)} CREDITS
              </span>
            )}
            {modelUsed && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-[#a855f7]/10 text-[#a855f7] border border-[#a855f7]/20">
                {modelUsed.split("/").pop()}
              </span>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-8 space-y-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Prompt area */}
            <div className="space-y-3">
              <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#00A3FF]/60">
                Mission Directive
              </label>

              <div
                className={`rounded-xl p-px transition-all duration-500 ${
                  focused ? "shadow-[0_0_40px_rgba(0,163,255,0.1)]" : ""
                }`}
                style={{
                  background: focused ? "linear-gradient(135deg, #00A3FF, #a855f7)" : "rgba(255,255,255,0.06)",
                }}
              >
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                  }}
                  placeholder="Describe the neural interface, landing page, or SaaS component..."
                  className="w-full rounded-xl px-6 py-5 text-sm bg-[#0a0f1e] text-slate-200 outline-none min-h-[160px] resize-none border-none"
                />
              </div>
            </div>

            {/* Execute button */}
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className="group relative w-full overflow-hidden rounded-xl py-4 transition-all active:scale-[0.98] disabled:opacity-30 disabled:grayscale"
            >
              <div
                className="absolute inset-0 transition-opacity group-hover:opacity-90"
                style={{ background: "linear-gradient(90deg, #00A3FF, #a855f7)" }}
              />
              <div className="relative flex items-center justify-center gap-3 font-bold text-xs uppercase tracking-[0.3em] text-[#020617]">
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-[#020617]/30 border-t-[#020617] animate-spin rounded-full" />
                    Neural Routing...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-current" />
                    Initialize Generation
                  </>
                )}
              </div>
            </button>

            {error && (
              <div className="rounded-xl px-5 py-4 text-xs font-mono bg-red-500/5 border border-red-500/20 text-red-400">
                [SYSTEM_ERROR]: {error}
              </div>
            )}

            {/* Preview Section */}
            {generatedCode && (
              <div className="pt-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#a855f7]">
                    Deployment Preview
                  </h3>
                  <button
                    onClick={() => {
                      const blob = new Blob([generatedCode], { type: "text/html" });
                      window.open(URL.createObjectURL(blob), "_blank");
                    }}
                    className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/30 hover:text-[#00A3FF] transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Full Screen
                  </button>
                </div>

                <div className="rounded-2xl overflow-hidden border border-white/5 shadow-2xl">
                  {/* Browser Mockup */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-[#080d1a] border-b border-white/5">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
                    </div>
                    <div className="ml-4 flex-1 bg-white/5 rounded px-3 py-1 text-[9px] text-white/20 font-mono truncate">
                      nazai://render-cache/{activeModel.split("/").pop()}
                    </div>
                  </div>
                  <iframe
                    srcDoc={generatedCode}
                    className="w-full h-[600px] bg-white"
                    sandbox="allow-scripts allow-same-origin"
                    title="NazAI Result"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Generator;
