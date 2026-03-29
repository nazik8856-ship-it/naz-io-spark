import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Zap, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Generator() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError("");

    console.log("[NazAI] 🚀 Calling naz-io-spark...");

    try {
      // FIXED: Using "naz-io-spark" instead of "swift-service"
      const { data, error: fnError } = await supabase.functions.invoke("naz-io-spark", {
        body: { prompt: prompt.trim() },
      });

      if (fnError) throw fnError;

      // Ensure we grab the code regardless of property name
      const code = data?.code || data?.content || data?.html || "";
      if (!code) throw new Error("AI returned empty code.");

      // Clean markdown fences if they exist
      const cleanCode = code.replace(/```html|```/g, "").trim();
      setGeneratedCode(cleanCode);
    } catch (err: any) {
      console.error("[NazAI] ❌ Error:", err);
      setError(err.message || "Connection failed. Check Supabase logs.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6 font-mono">
      <div className="max-w-5xl mx-auto">
        <header className="flex justify-between items-center mb-12">
          <button onClick={() => navigate("/")} className="text-white/40 hover:text-[#0ff] flex items-center gap-2">
            <ArrowLeft size={16} /> BACK
          </button>
          <div className="text-xl font-bold tracking-tighter">
            NAZ<span className="text-[#0ff]">AI</span> // GENERATOR
          </div>
          <div className="w-20" />
        </header>

        <div className="space-y-6">
          <textarea
            className="w-full bg-black border border-white/10 p-4 rounded-xl text-[#0ff] focus:border-[#f0f] outline-none transition-all"
            placeholder="Describe your obsidian-style landing page..."
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-[#0ff] to-[#f0f] text-black font-black uppercase tracking-widest rounded-xl hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "GLITCHING..." : "ACTIVATE AI"}
          </button>

          {error && <div className="p-4 border border-red-500/50 bg-red-500/10 text-red-500 rounded-lg">{error}</div>}

          {generatedCode && (
            <div className="mt-8 border border-white/10 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,255,255,0.1)]">
              <iframe srcDoc={generatedCode} className="w-full h-[600px] bg-white" title="Preview" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
