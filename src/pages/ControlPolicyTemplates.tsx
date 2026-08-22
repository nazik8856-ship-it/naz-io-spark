import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, LayoutTemplate, ShieldCheck, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canWriteAsOwner } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import { POLICY_TEMPLATES, resolveTemplateRules, type PolicyTemplate } from "@/lib/policy-templates";

type AgentOption = { id: string; name: string };

/**
 * POLICY TEMPLATES — starter guardrail playbooks a customer can one-click
 * apply instead of building a hard-rules list from a blank slate. Every
 * rule a template creates lands in shadow mode: nothing goes live until
 * the customer reviews and promotes it themselves, from the same Hard
 * Rules panel that already handles manually-authored shadow rules.
 */
export default function ControlPolicyTemplates() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId, role } = useActiveAccount();
  const canWrite = canWriteAsOwner(role);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [scopeAgentId, setScopeAgentId] = useState("");
  const [previewing, setPreviewing] = useState<PolicyTemplate | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const { data } = await anyDb.from("agents").select("id, name").eq("user_id", accountId).order("name");
    setAgents((data ?? []) as AgentOption[]);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const apply = async (template: PolicyTemplate) => {
    if (!user || !canWrite || applying) return;
    setApplying(template.id);
    const rows = resolveTemplateRules(template, scopeAgentId || null).map((r) => ({
      user_id: accountId,
      rule_text: r.rule_text,
      action_type_pattern: r.action_type_pattern,
      effect: r.effect,
      provider: r.provider ?? null,
      shadow_mode: true,
      agent_id: r.agent_id,
    }));
    const { error } = await anyDb.from("hard_rules").insert(rows);
    setApplying(null);
    if (error) {
      toast({ title: "Couldn't apply template", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    setPreviewing(null);
    toast({
      title: `"${template.name}" applied in shadow mode`,
      description: `${rows.length} rule(s) added, only observed for now — review and promote them from Hard rules.`,
    });
  };

  if (!user) return null;

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
          <LayoutTemplate className="h-5 w-5 text-cyan-300" /> Policy templates
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Starter guardrails for a new agent or account. Every rule a template creates starts in shadow
          mode — nothing goes live until you review and promote it from Hard rules.
        </p>

        {!canWrite && (
          <p className="mt-4 text-[11px] text-amber-300/80">
            You have view-only access — only the account owner or a team owner can apply a template.
          </p>
        )}

        {agents.length > 0 && (
          <div className="mt-4">
            <label className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Apply to
            </label>
            <select
              value={scopeAgentId}
              onChange={(e) => setScopeAgentId(e.target.value)}
              aria-label="Apply template to which agent"
              className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-300 outline-none"
            >
              <option value="">All agents (account-wide)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-6 space-y-4">
          {POLICY_TEMPLATES.map((t) => (
            <div key={t.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-zinc-100">{t.name}</p>
                  <p className="mt-1 text-sm text-zinc-400">{t.description}</p>
                  <p className="mt-2 font-mono text-[11px] text-zinc-500">
                    {t.rules.length} rule(s) · suggested strictness: {t.suggested_strictness ?? "balanced"}
                    {t.suggested_daily_cap_usd ? ` · suggested daily cap: $${t.suggested_daily_cap_usd}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => setPreviewing(previewing?.id === t.id ? null : t)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/10"
                  >
                    <Eye className="h-3.5 w-3.5" /> {previewing?.id === t.id ? "Hide preview" : "Preview"}
                  </button>
                  {canWrite && (
                    <button
                      onClick={() => apply(t)}
                      disabled={applying === t.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-400 disabled:opacity-40"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> {applying === t.id ? "Applying…" : "Apply (shadow mode)"}
                    </button>
                  )}
                </div>
              </div>

              {previewing?.id === t.id && (
                <ul className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                  {t.rules.map((r, i) => (
                    <li key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-xs">
                      <span className="text-zinc-200">{r.rule_text}</span>
                      <span className="ml-2 font-mono text-zinc-500">
                        {r.action_type_pattern}
                        {r.provider ? ` · ${r.provider}` : ""}
                        {" · "}
                        {r.effect === "always_block" ? "always blocked" : "approval required"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
