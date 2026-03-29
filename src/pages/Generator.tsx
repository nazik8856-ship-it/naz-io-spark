import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const Generator = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
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
      const html = data?.html_code || data?.content || "";
      setGeneratedCode(html);
    } catch (err: any) {
      setError(err.message || "Failed to generate.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <button onClick={() => navigate("/")} className="flex items-center gap-2 mb-8 opacity-50 hover:opacity-100">
        <ArrowLeft size={16} /> Back to Home
      </button>
      
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="text-cyan-400" /> NazAI Generator
        </h1>
        
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 h-32 focus:border-cyan-500 outline-none"
          placeholder="Describe the website you want to build..."
        />
        
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all"
        >
          <Zap fill="currentColor" />
          {loading ? "Generating..." : "Generate Website"}
        </button>

        {error && <div className="text-red-400 bg-red-400/10 p-4 rounded-lg border border-red-400/20">{error}</div>}

        {generatedCode && (
          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-white h-[500px]">
            <iframe srcDoc={generatedCode} className="w-full h-full" title="Preview" />
          </div>
        )}
      </div>
    </div>
  );
};

export default Generator;
