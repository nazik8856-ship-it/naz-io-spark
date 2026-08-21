import { useCallback, useEffect, useState } from "react";
import { Gavel, Plus, Trash2, ChevronDown, Eye, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canWriteAsOwner } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";

type Effect = "always_block" | "always_require_approval";

type HardRule = {
  id: string;
  rule_text: string;
  action_type_pattern: string;
  effect: Effect;
  provider: string | null;
  shadow_mode: boolean;
  created_at: string;
  agent_id: string | null;
};

type AgentOption = { id: string; name: string };

type ShadowReport = { hits: number; decisions: number };

const SCOPES: { label: string; pattern: string }[] = [
  { label: "Any action", pattern: "*" },
  { label: "Sending email", pattern: "send_email" },
  { label: "Replying to email", pattern: "reply_email" },
  { label: "Posting to Slack", pattern: "slack_*" },
  { label: "Notion writes", pattern: "notion_*" },
  { label: "Canva writes", pattern: "canva_*" },
  { label: "Shopify writes", pattern: "shopify_*" },
  { label: "Figma writes", pattern: "figma_*" },
  { label: "Calendar events", pattern: "create_calendar_event" },
  { label: "Docs & sheets", pattern: "*_doc*" },
];

/**
 * HARD RULES — user-authored, non-negotiable guardrails.
 * Live rules decide matching actions outright (the model is never called).
 * Shadow rules are evaluated and logged only — they never change an outcome,
 * so you can see the impact before promoting one to live.
 */
export default function HardRulesPanel() {
  const { user } = useAuth();
  const { accountId, role } = useActiveAccount();
  const canWrite = canWriteAsOwner(role);
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<HardRule[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [reports, setReports] = useState<Record<string, ShadowReport>>({});
  const [text, setText] = useState("");
  const [scope, setScope] = useState("*");
  const [effect, setEffect] = useState<Effect>("always_block");
  const [shadow, setShadow] = useState(true);
  const [busy, setBusy] = useState(false);
  // Which agent this new rule applies to -- "" means account-wide (the
  // default, matches every existing rule and every account that never
  // sets a per-agent override).
  const [appliesToAgentId, setAppliesToAgentId] = useState("");
  const [dualControl, setDualControl] = useState(false);
  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? "Unknown agent" : "All agents");

  const load = useCallback(async () => {
    if (!accountId) return;
    const [{ data }, { data: agentRows }, { data: profile }] = await Promise.all([
      supabase
        .from("hard_rules")
        .select("id, rule_text, action_type_pattern, effect, provider, shadow_mode, created_at, agent_id")
        .eq("user_id", accountId)
        .order("created_at", { ascending: false }),
      supabase.from("agents").select("id, name").eq("user_id", accountId).order("name"),
      supabase.from("profiles").select("require_dual_control_for_policy").eq("id", accountId).maybeSingle(),
    ]);
    const list = (data ?? []) as HardRule[];
    setRules(list);
    setAgents((agentRows ?? []) as AgentOption[]);
    setDualControl(!!(profile as { require_dual_control_for_policy?: boolean } | null)?.require_dual_control_for_policy);

    // "If this rule goes live, it would have affected N of the last M decisions."
    const shadowRules = list.filter((r) => r.shadow_mode);
    const next: Record<string, ShadowReport> = {};
    await Promise.all(
      shadowRules.map(async (r) => {
        const [{ count: hits }, { count: decisions }] = await Promise.all([
          supabase
            .from("hard_rule_shadow_hits")
            .select("id", { count: "exact", head: true })
            .eq("rule_id", r.id),
          supabase
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

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!user || !canWrite || !text.trim() || busy) return;
    setBusy(true);
    const { error } = await supabase.from("hard_rules").insert({
      user_id: accountId,
      rule_text: text.trim(),
      action_type_pattern: scope,
      effect,
      shadow_mode: shadow,
      agent_id: appliesToAgentId || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not save rule", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    setText("");
    toast({
      title: shadow ? "Rule saved in shadow mode" : "Rule saved",
      description: shadow
        ? "It's only observed and logged — nothing is blocked yet."
        : "It applies before any model scoring.",
    });
    void load();
  };

  const promote = async (r: HardRule) => {
    if (!canWrite) return;
    if (dualControl) {
      const { error } = await supabase.rpc("request_policy_change", {
        _change_type: "promote_hard_rule",
        _row_id: r.id,
        _description: `Promote "${r.rule_text}" to live`,
      });
      if (error) {
        toast({ title: "Could not request promotion", description: friendlyErrorMessage(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Promotion requested", description: "A second owner needs to approve this from Policy change requests before it goes live." });
      return;
    }
    const { error } = await supabase
      .from("hard_rules")
      .update({ shadow_mode: false, promoted_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      toast({ title: "Could not promote rule", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({ title: "Rule is now live", description: "It will decide matching actions from now on." });
    void load();
  };

  const toggleDualControl = async (checked: boolean) => {
    if (!canWrite) return;
    setDualControl(checked);
    const { error } = await supabase.from("profiles").update({ require_dual_control_for_policy: checked }).eq("id", accountId);
    if (error) {
      setDualControl(!checked);
      toast({ title: "Couldn't save that", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({
      title: checked ? "Dual control enabled" : "Dual control turned off",
      description: checked ? "Promoting a rule to live now needs a second owner's approval." : undefined,
    });
  };

  const remove = async (id: string) => {
    if (!canWrite) return;
    const { error } = await supabase.from("hard_rules").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not remove rule", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    void load();
  };

  if (!user) return null;

  return (
    <section className="mx-6 mb-3 rounded-xl border border-white/10 bg-white/[0.03]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <Gavel className="h-4 w-4 text-zinc-400" />
        <span className="flex-1 text-xs font-mono uppercase tracking-wider text-zinc-300">
          Hard rules{rules.length ? ` · ${rules.length}` : ""}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 py-4 space-y-4">
          <p className="text-[11px] text-zinc-500">
            Live rules are enforced before any AI judgement. Shadow rules are only watched and
            logged, so you can see what they would have done before turning them on.
          </p>

          {canWrite && (
            <label className="flex items-center gap-2 text-[11px] text-zinc-400">
              <input
                type="checkbox"
                checked={dualControl}
                onChange={(e) => void toggleDualControl(e.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-500"
              />
              Require a second owner to approve promoting a rule to live
              {dualControl && (
                <a href="/control-system/policy-changes" className="ml-1 underline hover:text-white">
                  view requests
                </a>
              )}
            </label>
          )}

          {!canWrite && (
            <p className="text-[11px] text-amber-300/80">
              You have view-only access to this account's hard rules — only the account owner or a team owner can add, promote, or remove them.
            </p>
          )}

          {canWrite && (
          <div className="space-y-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
              placeholder="e.g. never send email to more than 1 person"
              aria-label="Rule in plain English"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/25"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                aria-label="Applies to"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              >
                {SCOPES.map((s) => (
                  <option key={s.pattern} value={s.pattern}>{s.label}</option>
                ))}
              </select>
              <select
                value={effect}
                onChange={(e) => setEffect(e.target.value as Effect)}
                aria-label="Effect"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              >
                <option value="always_block">Always block</option>
                <option value="always_require_approval">Always require approval</option>
              </select>
              <select
                value={shadow ? "shadow" : "live"}
                onChange={(e) => setShadow(e.target.value === "shadow")}
                aria-label="Rule mode"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              >
                <option value="shadow">Shadow (observe only)</option>
                <option value="live">Live (enforce now)</option>
              </select>
              {agents.length > 0 && (
                <select
                  value={appliesToAgentId}
                  onChange={(e) => setAppliesToAgentId(e.target.value)}
                  aria-label="Applies to which agent"
                  className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
                >
                  <option value="">All agents (account-wide)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={add}
                disabled={busy || !text.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-400 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add rule
              </button>
            </div>
          </div>
          )}

          {rules.length === 0 ? (
            <p className="text-[11px] font-mono text-zinc-600">No hard rules yet.</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((r) => {
                const rep = reports[r.id];
                return (
                  <li
                    key={r.id}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                      r.shadow_mode
                        ? "border-amber-500/25 bg-amber-500/[0.04]"
                        : "border-white/10 bg-black/30"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-zinc-200">{r.rule_text}</p>
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                            r.shadow_mode
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {r.shadow_mode ? <Eye className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                          {r.shadow_mode ? "Shadow" : "Live"}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-zinc-500">
                        {SCOPES.find((s) => s.pattern === r.action_type_pattern)?.label ?? r.action_type_pattern}
                        {" · "}
                        {r.effect === "always_block" ? "always blocked" : "approval required"}
                        {" · "}
                        <span className={r.agent_id ? "text-cyan-400" : ""}>{agentName(r.agent_id)}</span>
                      </p>
                      {r.shadow_mode && (
                        <div className="mt-1.5 space-y-1.5">
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
                    {canWrite && (
                      <button
                        onClick={() => remove(r.id)}
                        aria-label={`Remove rule: ${r.rule_text}`}
                        className="text-zinc-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
