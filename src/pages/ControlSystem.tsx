import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, X, Sparkles } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import LiveAgentChat from "@/components/agents/LiveAgentChat";
import DecisionCard, { type ControlDecision } from "@/components/control/DecisionCard";
import KillSwitchPanel from "@/components/control/KillSwitchPanel";
import HardRulesPanel from "@/components/control/HardRulesPanel";
import CircuitBreakerPanel from "@/components/control/CircuitBreakerPanel";
import SpendCapPanel from "@/components/control/SpendCapPanel";


import DryRunToggle from "@/components/control/DryRunToggle";
import StrictnessPanel from "@/components/control/StrictnessPanel";
import RetentionPanel from "@/components/control/RetentionPanel";
import AccountSwitcher from "@/components/control/AccountSwitcher";
import PolicyOverviewPanel from "@/components/control/PolicyOverviewPanel";
import NotificationPreferencesPanel from "@/components/control/NotificationPreferencesPanel";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { toast } from "@/hooks/use-toast";

type Turn = { role: "user" | "assistant"; content: string; node?: ReactNode };

const TEMPLATES_NUDGE_DISMISSED_KEY = "nazai_templates_nudge_dismissed";

/**
 * AI CONTROL SYSTEM
 * Chat front-end for the shared decision engine (control-system-decide).
 * Every verdict is logged to agent_decisions alongside agent-triggered ones.
 */
export default function ControlSystem() {
  const navigate = useNavigate();
  const { accountId } = useActiveAccount();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [showTemplatesNudge, setShowTemplatesNudge] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    try {
      if (localStorage.getItem(TEMPLATES_NUDGE_DISMISSED_KEY) === accountId) return;
    } catch { /* localStorage unavailable -- fall through and check anyway */ }
    (async () => {
      // A brand-new account gets zero seeded hard_rules/safety_rules --
      // handle_new_user() only inserts a profiles row, nothing nudges a
      // fresh account toward ControlPolicyTemplates.tsx otherwise.
      const [hardRules, safetyRules] = await Promise.all([
        anyDb.from("hard_rules").select("id", { count: "exact", head: true }).eq("user_id", accountId),
        anyDb.from("safety_rules").select("id", { count: "exact", head: true }).eq("user_id", accountId),
      ]);
      if (cancelled) return;
      if ((hardRules.count ?? 0) === 0 && (safetyRules.count ?? 0) === 0) {
        setShowTemplatesNudge(true);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  const dismissTemplatesNudge = () => {
    setShowTemplatesNudge(false);
    try {
      localStorage.setItem(TEMPLATES_NUDGE_DISMISSED_KEY, accountId);
    } catch { /* best effort -- worst case it reappears next visit */ }
  };

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
          <AccountSwitcher />
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
          <button
            onClick={() => navigate("/control-system/team")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Team
          </button>
          <button
            onClick={() => navigate("/control-system/templates")}
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
          >
            Templates
          </button>
          <button
            onClick={() => navigate("/control-system/rule-effectiveness")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Rule effectiveness
          </button>
          <button
            onClick={() => navigate("/control-system/confidence-calibration")}
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
          >
            Confidence calibration
          </button>
          <button
            onClick={() => navigate("/control-system/roi")}
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20"
          >
            ROI report
          </button>
          <button
            onClick={() => navigate("/control-system/agent-policy")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Agent policy
          </button>
          <button
            onClick={() => navigate("/control-system/live")}
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20"
          >
            Live feed
          </button>
          <button
            onClick={() => navigate("/control-system/account-data")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Account data
          </button>
          <button
            onClick={() => navigate("/control-system/policy-bundle")}
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
          >
            Policy as code
          </button>
          <button
            onClick={() => navigate("/control-system/policy-changes")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Policy change requests
          </button>
          <button
            onClick={() => navigate("/control-system/audit-verify")}
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
          >
            Verify audit trail
          </button>
          <button
            onClick={() => navigate("/control-system/decision-history")}
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Decision history
          </button>
        </nav>
      </header>

      {showTemplatesNudge && (
        <div className="flex items-center gap-3 border-b border-cyan-500/20 bg-cyan-500/[0.06] px-6 py-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-cyan-300" />
          <p className="text-xs text-cyan-100">
            No hard rules or safety rules set up yet — start from a policy template so your AI has real guardrails from day one.
          </p>
          <button
            onClick={() => navigate("/control-system/templates")}
            className="ml-auto shrink-0 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
          >
            Browse templates
          </button>
          <button
            onClick={dismissTemplatesNudge}
            aria-label="Dismiss"
            className="shrink-0 text-cyan-300/60 hover:text-cyan-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}


      <StrictnessPanel />
      <KillSwitchPanel />
      <SpendCapPanel />
      <RetentionPanel />

      <CircuitBreakerPanel />
      <HardRulesPanel />
      <PolicyOverviewPanel />
      <NotificationPreferencesPanel />
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
