import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LiveAgentChat from "@/components/agents/LiveAgentChat";
import DecisionCard, { type ControlDecision } from "@/components/control/DecisionCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Turn = { role: "user" | "assistant"; content: string; node?: ReactNode };

/**
 * AI CONTROL SYSTEM
 * Chat front-end for the shared decision engine (control-system-decide).
 * Every verdict is logged to agent_decisions alongside agent-triggered ones.
 */
export default function ControlSystem() {
  const navigate = useNavigate();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);

  const handleSend = async (text: string) => {
    setTurns((t) => [...t, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const { data, error } = await supabase.functions.invoke("control-system-decide", {
        body: { message: text },
      });
      if (error) throw error;
      const d = data as ControlDecision & { error?: string; message?: string };
      if (d?.error) throw new Error(d.message || d.error);

      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = {
          role: "assistant",
          content: d.reason,
          node: <DecisionCard d={d} />,
        };
        return next;
      });
    } catch (e) {
      const msg = (e as Error)?.message || "Something went wrong reviewing that action.";
      toast({ title: "Decision failed", description: msg, variant: "destructive" });
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = { role: "assistant", content: msg };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>
      </header>

      <div className="flex-1 min-h-0">
        <LiveAgentChat
          agentId="control-system"
          name="AI Control System"
          goal="Your AI's decisions, explained and controlled"
          turns={turns}
          suggestions={[
            "My agent wants to post to #general",
            "Should I let this run: send email to all customers",
            "Agent wants to update product prices in Shopify",
          ]}
          streaming={streaming}
          fullSpec="Describe any action your AI wants to take. The Control System scores intent match, risk and confidence, then returns Allow, Modify, Block or Deferred — and logs it to your decision history."
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
