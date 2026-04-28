import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const TestEmail = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  const send = async () => {
    setLoading(true);
    setResult("Sending…");
    console.log("📧 Triggering send-test-email…");
    try {
      const { data, error } = await supabase.functions.invoke("send-test-email", {
        body: { to: "nazik8856@gmail.com" },
      });
      if (error) {
        console.error("❌ Test email failed:", error);
        setResult(`❌ Failed: ${error.message}`);
      } else {
        console.log("✅ Test email response:", data);
        setResult(`✅ Sent! ID: ${data?.id ?? "(no id)"} → ${data?.to ?? ""}`);
      }
    } catch (err) {
      console.error("❌ Test email exception:", err);
      setResult(`❌ Exception: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#020617] p-6">
      <div className="w-full max-w-md border border-[#00A3FF]/20 bg-black/40 p-8 rounded-lg">
        <h1 className="text-white text-2xl font-bold mb-2">Resend Test</h1>
        <p className="text-white/60 text-sm mb-6">
          Sends a basic test email to <span className="text-[#00A3FF]">nazik8856@gmail.com</span> via the
          <code className="text-white/80"> send-test-email</code> edge function.
        </p>
        <Button
          onClick={send}
          disabled={loading}
          className="w-full bg-[#00A3FF] hover:bg-[#00A3FF]/80 text-black font-semibold"
        >
          {loading ? "Sending…" : "Send Test Email"}
        </Button>
        {result && (
          <pre className="mt-4 text-xs text-white/80 whitespace-pre-wrap break-all border border-white/10 p-3 rounded bg-black/40">
            {result}
          </pre>
        )}
      </div>
    </div>
  );
};

export default TestEmail;
