import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LiveAgentChat from "@/components/agents/LiveAgentChat";

type Turn = { role: "user" | "assistant"; content: string };

/**
 * AI CONTROL SYSTEM — chat shell only.
 * Backend decision-engine wiring comes later; this is just the entry surface.
 */
export default function ControlSystem() {
  const navigate = useNavigate();
  const [turns, setTurns] = useState<Turn[]>([]);

  const handleSend = (text: string) => {
    setTurns((t) => [
      ...t,
      { role: "user", content: text },
      {
        role: "assistant",
        content:
          "The Control System engine isn't wired up yet — this is the chat surface. Decision tracing, approvals and overrides land in the next step.",
      },
    ]);
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
            "Why did my agent do that?",
            "Show recent decisions",
            "Pause risky actions",
          ]}
          streaming={false}
          fullSpec="Control System spec will appear here once the decision engine is connected."
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
