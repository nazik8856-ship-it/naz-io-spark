import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, X, Sparkles, Gauge, ChevronDown, ChevronRight } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canApprove } from "@/lib/account-switcher";
import LiveAgentChat from "@/components/agents/LiveAgentChat";
import DecisionCard, { type ControlDecision } from "@/components/control/DecisionCard";
import HardRulesPanel from "@/components/control/HardRulesPanel";
import SpendSafetyStatusBadge from "@/components/control/SpendSafetyStatusBadge";
import { useSpendSafetyStatus } from "@/hooks/useSpendSafetyStatus";
import { useControlDashboardData } from "@/hooks/useControlDashboardData";
import { usePendingApprovalsFeed } from "@/hooks/usePendingApprovalsFeed";
import ApprovalChatCard from "@/components/control/dashboard/ApprovalChatCard";


import DryRunToggle from "@/components/control/DryRunToggle";
import StrictnessPanel from "@/components/control/StrictnessPanel";
import RetentionPanel from "@/components/control/RetentionPanel";
import AccountSwitcher from "@/components/control/AccountSwitcher";
import PolicyOverviewPanel from "@/components/control/PolicyOverviewPanel";
import NotificationPreferencesPanel from "@/components/control/NotificationPreferencesPanel";
import ControlPagesMenu from "@/components/control/dashboard/ControlPagesMenu";
import SetupProgressBar from "@/components/control/dashboard/SetupProgressBar";
import RuleCoverageHealthCard from "@/components/control/dashboard/RuleCoverageHealthCard";
import StatSparkCard from "@/components/control/dashboard/StatSparkCard";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { toast } from "@/hooks/use-toast";
import { extractFunctionErrorMessage } from "@/lib/supabase-function-error";

type Turn = { role: "user" | "assistant"; content: string; node?: ReactNode };

const TEMPLATES_NUDGE_DISMISSED_KEY = "nazai_templates_nudge_dismissed";
const SPEND_NUDGE_DISMISSED_KEY = "nazai_spend_nudge_dismissed";
const SETTINGS_OPEN_KEY = "nazai_control_settings_open";

/**
 * AI CONTROL SYSTEM — landing dashboard (blueprint task #63 redesign).
 * Setup progress, real rule-coverage/system-health gauges and spend/
 * incident/efficiency stat cards replace the old flat panel stack; every
 * one of the ~25 sub-pages that used to live in the header nav is still
 * reachable from the "All pages" menu. The chat front-end for the shared
 * decision engine (control-system-decide) now docks on the right alongside
 * pending approvals, instead of being the whole page.
 */
export default function ControlSystem() {
  const navigate = useNavigate();
  const { accountId, role } = useActiveAccount();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [showTemplatesNudge, setShowTemplatesNudge] = useState(false);
  const [spendNudgeDismissed, setSpendNudgeDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const spendStatus = useSpendSafetyStatus(accountId);
  const dashboard = useControlDashboardData(accountId);
  const approvalsFeed = usePendingApprovalsFeed(accountId);
  const canSignOff = canApprove(role);

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

  useEffect(() => {
    if (!accountId) return;
    try {
      if (localStorage.getItem(SPEND_NUDGE_DISMISSED_KEY) === accountId) setSpendNudgeDismissed(true);
    } catch { /* localStorage unavailable -- fall through, banner just won't persist dismissal */ }
  }, [accountId]);

  useEffect(() => {
    try {
      if (localStorage.getItem(SETTINGS_OPEN_KEY) === "1") setSettingsOpen(true);
    } catch { /* best effort -- defaults to collapsed */ }
  }, []);

  const toggleSettings = () => {
    setSettingsOpen((o) => {
      const next = !o;
      try { localStorage.setItem(SETTINGS_OPEN_KEY, next ? "1" : "0"); } catch { /* best effort */ }
      return next;
    });
  };

  const dismissSpendNudge = () => {
    setSpendNudgeDismissed(true);
    try {
      localStorage.setItem(SPEND_NUDGE_DISMISSED_KEY, accountId);
    } catch { /* best effort -- worst case it reappears next visit */ }
  };

  // Pillar 1 first-run nudge: a brand-new account gets a silent $5/day
  // default (spend-guard.ts's DEFAULT_DAILY_CAP_USD) with nothing ever
  // prompting them to choose a real number -- confirmed live: every
  // account today has zero rows in ai_spend_caps. SpendCapPanel's own
  // inline "Default -- not set" tag only helps someone who already opened
  // that panel; this surfaces the same fact where a first-time visitor
  // actually lands, same pattern as the templates nudge above.
  const showSpendNudge = !spendStatus.loading && !spendStatus.capIsCustom && !spendNudgeDismissed;

  const handleSend = async (text: string) => {
    const history = turns
      .filter((t) => t.content)
      .map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const { data, error } = await supabase.functions.invoke("control-system-decide", {
        // Was missing entirely -- the entire review/execute flow silently
        // ran against the caller's own account regardless of which account
        // was selected via the switcher.
        body: { message: text, history, dry_run: dryRun, account_id: accountId || undefined },
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
      const msg = (await extractFunctionErrorMessage(e)) ?? (e as Error)?.message ?? "Something went wrong reviewing that action.";
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

  // Pending approvals rendered as real, actionable chat cards ahead of the
  // actual conversation -- never persisted into `turns` itself, since that
  // array also backs the message history sent to control-system-decide
  // (handleSend's `history`), which must stay exactly what was said, not
  // padded with synthetic approval cards.
  const chatTurns: Turn[] = [
    ...approvalsFeed.approvals.map((a): Turn => ({
      role: "assistant",
      content: "",
      node: (
        <ApprovalChatCard
          approval={a}
          canSignOff={canSignOff}
          resolving={approvalsFeed.resolvingId === a.id}
          onResolve={(vote) => approvalsFeed.resolve(a.id, vote)}
        />
      ),
    })),
    ...turns,
  ];

  const setupChecks = [
    { label: "Hard rules configured", done: dashboard.setup.hardRules, onClick: () => navigate("/control-system/safety-rules") },
    { label: "Safety rules configured", done: dashboard.setup.safetyRules, onClick: () => navigate("/control-system/safety-rules") },
    { label: "Daily spend limit set", done: dashboard.setup.spendCapCustom, onClick: () => navigate("/control-system/spend-safety") },
    { label: "An agent deployed", done: dashboard.setup.agentDeployed, onClick: () => navigate("/generator-home") },
  ];

  return (
    <div className="h-screen w-full flex flex-col text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/5 sm:px-6 sm:py-4">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>
        <div className="ml-2 flex items-center rounded-full border border-white/10 bg-white/5 p-1 text-[11px] font-mono uppercase tracking-wider">
          <button className="rounded-full px-3 py-1 text-white" style={{ background: "linear-gradient(135deg, rgba(0,242,255,0.25), rgba(212,175,55,0.25))" }}>
            Inner
          </button>
          <button
            onClick={() => navigate("/control-system/outer")}
            className="rounded-full px-3 py-1 text-zinc-400 hover:text-white transition-colors"
          >
            Outer
          </button>
        </div>
        <nav className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <AccountSwitcher />
          <button
            onClick={() => navigate("/control-system/approvals")}
            className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-500/20"
          >
            Approvals
          </button>
          <button
            onClick={() => navigate("/control-system/incidents")}
            className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-rose-300 hover:bg-rose-500/20"
          >
            Incidents
          </button>
          <ControlPagesMenu />
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

      {showSpendNudge && (
        <div className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/[0.06] px-6 py-2.5">
          <Gauge className="h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-xs text-amber-100">
            You haven't set a daily AI spend limit — a silent $5.00/day default is applying right now. Choose a number you actually picked.
          </p>
          <button
            onClick={() => navigate("/control-system/spend-safety")}
            className="ml-auto shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-500/20"
          >
            Set spend limit
          </button>
          <button
            onClick={dismissSpendNudge}
            aria-label="Dismiss"
            className="shrink-0 text-amber-300/60 hover:text-amber-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-visible">
        {/* Left: dashboard */}
        <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-4 p-6">
            <SetupProgressBar pct={dashboard.setup.pct} checks={setupChecks} />

            <RuleCoverageHealthCard
              coveragePct={dashboard.coveragePct}
              coverageGapCount={dashboard.coverageGapCount}
              coverageTotal={dashboard.coverageTotal}
              coverageCells={dashboard.coverageCells}
              healthPct={dashboard.healthPct}
              onCoverageClick={() => navigate("/control-system/coverage")}
              onHealthClick={() => navigate("/control-system/health")}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatSparkCard
                label="Daily spend"
                value={`$${dashboard.spend.today.toFixed(2)}`}
                sub={`of $${dashboard.spend.cap.toFixed(2)} cap${dashboard.spend.capIsCustom ? "" : " (default)"}`}
                tone={dashboard.spend.today >= dashboard.spend.cap ? "bad" : dashboard.spend.today >= dashboard.spend.cap * 0.8 ? "warn" : "ok"}
                series={dashboard.spend.series}
                onClick={() => navigate("/control-system/spend-safety")}
              />
              <StatSparkCard
                label="Recent incidents"
                value={String(dashboard.incidents.openCount)}
                sub="open, last 7 days shown"
                tone={dashboard.incidents.openCount > 0 ? "warn" : "ok"}
                series={dashboard.incidents.series}
                onClick={() => navigate("/control-system/incidents")}
              />
              <StatSparkCard
                label="AI agent efficiency"
                value={dashboard.efficiency.autonomousPct === null ? "—" : `${dashboard.efficiency.autonomousPct}%`}
                sub="autonomous, no human needed"
                tone="neutral"
                series={dashboard.efficiency.series}
                onClick={() => navigate("/control-system/roi")}
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03]">
              <button
                onClick={toggleSettings}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  Quick settings — rules, retention, notifications
                </span>
                {settingsOpen ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
              </button>
              {settingsOpen && (
                <div className="space-y-0 border-t border-white/5">
                  <SpendSafetyStatusBadge />
                  <StrictnessPanel />
                  <RetentionPanel />
                  <HardRulesPanel />
                  <PolicyOverviewPanel />
                  <NotificationPreferencesPanel />
                  <DryRunToggle on={dryRun} onChange={setDryRun} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: a single unified Agent Status panel -- pending approvals
            render as real, actionable cards right inside the conversation
            (per the reference mockup), instead of a separate boxed list. */}
        <div className="flex w-full min-h-[480px] shrink-0 flex-col border-t border-white/5 bg-[#050813] lg:min-h-0 lg:w-[380px] lg:border-l lg:border-t-0">
          <LiveAgentChat
            agentId="control-system"
            name="AI Control System"
            goal="Your AI's decisions, explained and controlled"
            turns={chatTurns}
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
    </div>
  );
}
