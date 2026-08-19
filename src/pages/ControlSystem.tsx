import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LiveAgentChat from "@/components/agents/LiveAgentChat";
import DecisionCard, { type ControlDecision } from "@/components/control/DecisionCard";
import KillSwitchPanel from "@/components/control/KillSwitchPanel";
import HardRulesPanel from "@/components/control/HardRulesPanel";
import CircuitBreakerPanel from "@/components/control/CircuitBreakerPanel";
import SpendCapPanel from "@/components/control/SpendCapPanel";


import DryRunToggle from "@/components/control/DryRunToggle";
import StrictnessPanel from "@/components/control/StrictnessPanel";
import RetentionPanel from "@/components/control/RetentionPanel";
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
  const [dryRun, setDryRun] = useState(false);

  const handleSend = async (text: string) => {
    const history = turns
      .filter((t) => t.content)
      .map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const { data, error } = await supabase.functions.invoke("control-system-decide", {
        body: { message: text, history, dry_run: dryRun },
      });
      if (error) throw error;
      const d = data as ControlDecision & { error?: string; message?: string; mode?: string; reply?: string };
      if (d?.error) throw new Error(d.message || d.error);

      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = d?.mode === "chat"
          ? { role: "assistant", content: d.reply || "" }
          : { role: "assistant", content: d.reason, node: <DecisionCard d={d} /> };
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
        <nav className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate("/control-system/approvals")}
            className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-500/20"
          >
            Approvals
          </button>
          <button
            onClick={() => navigate("/control-system/pending")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Pending decisions
          </button>
          <button
            onClick={() => navigate("/control-system/safety-rules")}
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
          >
            Safety rules
          </button>
          <button
            onClick={() => navigate("/control-system/incidents")}
            className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-rose-300 hover:bg-rose-500/20"
          >
            Incidents
          </button>
          <button
            onClick={() => navigate("/control-system/simulator")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Rule simulator
          </button>
          <button
            onClick={() => navigate("/control-system/health")}
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20"
          >
            Health
          </button>
          <button
            onClick={() => navigate("/control-system/changes")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Change log
          </button>
          <button
            onClick={() => navigate("/control-system/coverage")}
            className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-500/20"
          >
            Coverage gaps
          </button>
          <button
            onClick={() => navigate("/control-system/webhooks")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Webhooks
          </button>
          <button
            onClick={() => navigate("/control-system/compliance")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Compliance report
          </button>
        </nav>
      </header>


      <StrictnessPanel />
      <KillSwitchPanel />
      <SpendCapPanel />
      <RetentionPanel />

      <CircuitBreakerPanel />
      <HardRulesPanel />
      <DryRunToggle on={dryRun} onChange={setDryRun} />


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
