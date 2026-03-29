import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Generator = () => {
  const [prompt, setPrompt] = useState("");
  const [generatedHtml, setGeneratedHtml] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGenerate = async () => {
    if (!prompt) return;
    setIsLoading(true);
    toast({ title: "Connecting", description: "NazAI is starting the workshop..." });

    try {
      console.log("[NazAI] 📡 Sending handshake to naz-io-spark...");

      // THIS IS THE CRITICAL LOGIC THAT FIXES THE CONNECTION
      const { data, error } = await supabase.functions.invoke("naz-io-spark", {
        body: { prompt },
      });

      if (error) throw error;

      if (data?.code) {
        // AI logic often sends backticks. This cleans them.
        const cleanHtml = data.code.replace(/```html|```/g, "").trim();
        setGeneratedHtml(cleanHtml);
        toast({ title: "Success!", description: "AI code loaded into the preview." });
      } else {
        throw new Error("AI returned empty code.");
      }
    } catch (err: any) {
      console.error("[NazAI] ❌ Connection error:", err);
      toast({
        variant: "destructive",
        title: "Handshake Failed",
        description: err.message || "Failed to talk to the Edge Function.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold text-[#0ff] drop-shadow-[0_0_10px_#0ff]">NazAI Workshop</h1>

        <div className="flex gap-4">
          <Input
            placeholder="A chocolate factory with neon borders..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="bg-black border-[#f0f] text-white focus:ring-[#f0f]"
          />
          <Button
            onClick={handleGenerate}
            disabled={isLoading}
            className="bg-[#f0f] hover:bg-[#d0d] text-black font-bold px-8"
          >
            {isLoading ? "Generating..." : "Generate"}
          </Button>
        </div>

        {/* THE PREVIEW WINDOW - This is where the old look comes alive */}
        {generatedHtml && (
          <div className="border-2 border-[#0ff] rounded-lg overflow-hidden shadow-[0_0_30px_rgba(0,255,255,0.2)]">
            <iframe srcDoc={generatedHtml} className="w-full h-[600px] bg-white" title="Preview" />
          </div>
        )}
      </div>
    </div>
  );
};

export default Generator;
