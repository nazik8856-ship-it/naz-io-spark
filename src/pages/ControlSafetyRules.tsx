import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ScanSearch, Plus, Trash2, Eye, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { hasPermission } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import { findSafetyRuleRedundancies } from "@/lib/safety-rule-redundancy";

type Severity = "block" | "require_approval";
type Rule = {
  id: string;
  name: string;
  category: string;
  pattern: string;
  severity: Severity;
  enabled: boolean;
  agent_id: string | null;
  shadow_mode: boolean;
  created_at: string;
};

type AgentOption = { id: string; name: string };

type ShadowReport = { hits: number; decisions: number };

// Mirrors BUILTIN_SAFETY_RULES in the edge function — shown read-only.
const BUILTINS: { name: string; category: string; severity: Severity }[] = [
  { name: "API key or secret in payload", category: "secrets", severity: "block" },
  { name: "Payment card number", category: "pii", severity: "block" },
  { name: "National ID / SSN pattern", category: "pii", severity: "block" },
  { name: "Destructive wording", category: "destructive", severity: "block" },
  { name: "Refund or cancellation without a reference", category: "financial", severity: "require_approval" },
  { name: "Mass-audience send", category: "reach", severity: "require_approval" },
  { name: "Disposable recipient domain", category: "recipients", severity: "block" },
];

/**
 * SAFETY RULES — the deterministic, non-model scan that runs inside the
 * control gate before any AI judgement. Pure pattern matching, so a model
 * mistake alone can never let a high-stakes action through.
 */
export default function ControlSafetyRules() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId, role, permissions } = useActiveAccount();
  const canWrite = hasPermission(role, permissions, "policy");
  const [rules, setRules] = useState<Rule[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [reports, setReports] = useState<Record<string, ShadowReport>>({});
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [severity, setSeverity] = useState<Severity>("require_approval");
  const [shadow, setShadow] = useState(true);
  const [appliesToAgentId, setAppliesToAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dualControl, setDualControl] = useState(false);
  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? "Unknown agent" : "All agents");
  const redundancies = findSafetyRuleRedundancies(rules);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [{ data }, { data: agentRows }, { data: profile }] = await Promise.all([
      anyDb
        .from("safety_rules")
        .select("id, name, category, pattern, severity, enabled, agent_id, shadow_mode, created_at")
        .eq("user_id", accountId)
        .order("created_at", { ascending: false }),
      anyDb.from("agents").select("id, name").eq("user_id", accountId).order("name"),
      anyDb.from("profiles").select("require_dual_control_for_policy").eq("id", accountId).maybeSingle(),
    ]);
    const list = (data ?? []) as unknown as Rule[];
    setRules(list);
    setAgents((agentRows ?? []) as AgentOption[]);
    setDualControl(!!(profile as { require_dual_control_for_policy?: boolean } | null)?.require_dual_control_for_policy);

    // "If this rule goes live, it would have affected N of the last M decisions" —
    // same shadow-impact report HardRulesPanel already gives customers.
    const shadowRules = list.filter((r) => r.shadow_mode);
    const next: Record<string, ShadowReport> = {};
    await Promise.all(
      shadowRules.map(async (r) => {
        const [{ count: hits }, { count: decisions }] = await Promise.all([
          anyDb
            .from("safety_rule_shadow_hits")
            .select("id", { count: "exact", head: true })
            .eq("rule_id", r.id),
          anyDb
            .from("agent_decisions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", accountId)
            .gte("created_at", r.created_at),
        ]);
        next[r.id] = { hits: hits ?? 0, decisions: decisions ?? 0 };
      }),
    );
    setReports(next);
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!user || !canWrite || !name.trim() || !pattern.trim()) return;
    try { new RegExp(pattern); } catch {
      toast({ title: "That pattern isn't valid", description: "Check the expression and try again.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await anyDb.from("safety_rules").insert({
      user_id: accountId, name: name.trim(), pattern: pattern.trim(), severity, category: "custom",
      agent_id: appliesToAgentId || null,
      shadow_mode: shadow,
    });
    setBusy(false);
    if (error) { toast({ title: "Couldn't add rule", description: friendlyErrorMessage(error.message), variant: "destructive" }); return; }
    setName(""); setPattern("");
    toast({
      title: shadow ? "Rule saved in shadow mode" : "Rule saved",
      description: shadow
        ? "It's only observed and logged — nothing is blocked or sent to approval yet."
        : "It applies before any model scoring.",
    });
    load();
  };

  const toggle = async (r: Rule) => {
    if (!canWrite) return;
    await anyDb.from("safety_rules").update({ enabled: !r.enabled }).eq("id", r.id);
    load();
  };
  const promote = async (r: Rule) => {
    if (!canWrite) return;
    if (dualControl) {
      const { error } = await anyDb.rpc("request_policy_change", {
        _change_type: "promote_safety_rule",
        _row_id: r.id,
        _description: `Promote safety rule "${r.name}" to live`,
      });
      if (error) {
        toast({ title: "Could not request promotion", description: friendlyErrorMessage(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Promotion requested", description: "A second owner needs to approve this from Policy change requests before it goes live." });
      return;
    }
    const { error } = await anyDb
      .from("safety_rules")
      .update({ shadow_mode: false, promoted_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      toast({ title: "Could not promote rule", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({ title: "Rule is now live", description: "It will scan matching actions from now on." });
    load();
  };
  const remove = async (r: Rule) => {
    if (!canWrite) return;
    if (dualControl) {
      const { error } = await anyDb.rpc("request_policy_change", {
        _change_type: "delete_safety_rule",
        _row_id: r.id,
        _description: `Delete safety rule "${r.name}"`,
      });
      if (error) {
        toast({ title: "Could not request deletion", description: friendlyErrorMessage(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Deletion requested", description: "A second owner needs to approve this from Policy change requests before it's removed." });
      return;
    }
    const { error } = await anyDb.from("safety_rules").delete().eq("id", r.id);
    if (error) {
      toast({ title: "Could not remove rule", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    load();
  };

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ScanSearch className="h-5 w-5 text-cyan-300" /> Safety rules
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Pattern checks that run before any AI judgement. A live match either blocks the action
          outright or sends it to the approval queue. A shadow-mode rule is only watched and
          logged — nothing changes until you promote it.
        </p>

        {redundancies.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Redundant rules
            </p>
            {redundancies.map((r, i) => {
              const [blockRule, approvalRule] = r.older.severity === "block" ? [r.older, r.newer] : [r.newer, r.older];
              return (
                <p key={i} className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-[12px] text-zinc-300">
                  <span className="text-amber-300">"{blockRule.name}"</span> (block) and{" "}
                  <span className="text-amber-300">"{approvalRule.name}"</span> (require approval) have the same
                  (or near-identical) pattern — they always co-fire, so whenever "{approvalRule.name}" would match,
                  "{blockRule.name}" already blocks the action outright, making the approval rule's contribution moot there.
                </p>
              );
            })}
          </div>
        )}

        {canWrite ? (
        <section className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Add a rule</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="What it catches, e.g. Competitor mentions"
              className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
            />
            <input
              value={pattern} onChange={(e) => setPattern(e.target.value)}
              placeholder="Pattern, e.g. (acme|globex)"
              className="rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/50"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}
              className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none"
            >
              <option value="require_approval">Send to approval queue</option>
              <option value="block">Block outright</option>
            </select>
            <select
              value={shadow ? "shadow" : "live"}
              onChange={(e) => setShadow(e.target.value === "shadow")}
              aria-label="Rule mode"
              className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none"
            >
              <option value="shadow">Shadow (observe only)</option>
              <option value="live">Live (enforce now)</option>
            </select>
            {agents.length > 0 && (
              <select
                value={appliesToAgentId}
                onChange={(e) => setAppliesToAgentId(e.target.value)}
                aria-label="Applies to which agent"
                className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none"
              >
                <option value="">All agents (account-wide)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
            <button
              disabled={busy}
              onClick={add}
              className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-mono uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        </section>
        ) : (
          <p className="mt-6 text-[11px] text-amber-300/80">
            You have view-only access to this account's safety rules — only the account owner or a team owner can add, toggle, or remove them.
          </p>
        )}

        <section className="mt-6 space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Your rules</h2>
          {rules.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
              No custom rules yet — the built-in checks below still apply.
            </p>
          ) : rules.map((r) => {
            const rep = reports[r.id];
            return (
            <div
              key={r.id}
              className={`rounded-lg border p-3 ${r.shadow_mode ? "border-amber-500/25 bg-amber-500/[0.04]" : "border-white/10 bg-white/[0.03]"}`}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm text-zinc-200">{r.name}</p>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                        r.shadow_mode ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {r.shadow_mode ? <Eye className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                      {r.shadow_mode ? "Shadow" : "Live"}
                    </span>
                  </div>
                  <p className="truncate font-mono text-[11px] text-zinc-500">{r.pattern}</p>
                  <p className={`font-mono text-[10px] ${r.agent_id ? "text-cyan-400" : "text-zinc-600"}`}>{agentName(r.agent_id)}</p>
                </div>
                <span className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase ${
                  r.severity === "block"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                }`}>
                  {r.severity === "block" ? "block" : "approval"}
                </span>
                {canWrite && (
                  <>
                    <button onClick={() => toggle(r)} className="text-[10px] font-mono uppercase text-zinc-400 hover:text-white">
                      {r.enabled ? "on" : "off"}
                    </button>
                    <button onClick={() => remove(r)} className="text-zinc-500 hover:text-rose-300" aria-label="Delete rule">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
              {r.shadow_mode && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] text-amber-300/80">
                    {rep
                      ? rep.decisions === 0
                        ? "No decisions yet since this rule was created — nothing to report."
                        : `If this rule goes live, it would have affected ${rep.hits} of the last ${rep.decisions} decisions.`
                      : "Measuring impact…"}
                  </p>
                  {canWrite && (
                    <button
                      onClick={() => promote(r)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-400"
                    >
                      <ShieldCheck className="h-3 w-3" /> Promote to live
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Built-in checks (always on)</h2>
          {BUILTINS.map((b) => (
            <div key={b.name} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <p className="min-w-0 flex-1 truncate text-sm text-zinc-300">{b.name}</p>
              <span className="text-[10px] font-mono uppercase text-zinc-500">{b.category}</span>
              <span className={`text-[10px] font-mono uppercase ${b.severity === "block" ? "text-rose-300" : "text-amber-300"}`}>
                {b.severity === "block" ? "block" : "approval"}
              </span>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
