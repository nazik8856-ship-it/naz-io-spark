import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Sparkles, Download, Code, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

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
      
      // Clean the code: Remove markdown backticks if the AI included them
      let rawHTML = data?.html_code || data?.content || "";
      const cleanHTML = rawHTML.replace(/```html|```/g, "").trim(); 
      
      setGeneratedCode(cleanHTML);
    } catch (err: any) {
      setError(err.message || "Failed to generate.");
    } finally {
      setLoading(false);
    }
  };

  const downloadCode = () => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nazai-website.html";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <button 
        onClick={() => navigate("/")} 
        className="flex items-center gap-2 mb-8 opacity-50 hover:opacity-100 transition-opacity"
      >
        <ArrowLeft size={16} /> Back to Dashboard
      </button>
      
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Side: Controls */}
        <div className="lg:col-span-4 space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Sparkles className="text-cyan-400" /> NazAI
            </h1>
            <p className="text-zinc-400 text-sm">Describe your vision, and we'll build the code.</p>
          </div>
          
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 h-48 focus:border-cyan-500 outline-none resize-none transition-colors"
            placeholder="e.g. A dark-themed landing page for a coffee shop with a glassmorphism menu..."
          />
          
          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold h-12 rounded-xl flex items-center justify-center gap-2"
          >
            <Zap size={18} fill="currentColor" />
            {loading ? "Crafting Code..." : "Generate Website"}
          </Button>

          {generatedCode && (
            <Button
              onClick={downloadCode}
              variant="outline"
              className="w-full border-zinc-800 hover:bg-zinc-900 text-white h-12 rounded-xl flex items-center justify-center gap-2"
            >
              <Download size={18} />
              Download HTML
            </Button>
          )}

          {error && (
            <div className="text-red-400 bg-red-400/10 p-4 rounded-lg border border-red-400/20 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Right Side: Preview */}
        <div className="lg:col-span-8">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden h-[70vh] flex flex-col">
            <div className="bg-zinc-800/50 p-3 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/20" />
                <div className="w-3 h-3 rounded-full bg-amber-500/20" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/20" />
              </div>
              <span className="text-xs text-zinc-500 font-mono">live_preview.html</span>
              <div className="w-10" />
            </div>
            
            <div className="flex-1 bg-white relative">
              {generatedCode ? (
                <iframe 
                  srcDoc={generatedCode} 
                  className="w-full h-full border-none" 
                  title="NazAI Preview" 
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-300 gap-3">
                  <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center">
                    <Eye className="text-zinc-400" />
                  </div>
                  <p className="text-sm font-medium">Your preview will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Generator;
