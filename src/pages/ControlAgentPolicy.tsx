import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bot, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canWriteAsOwner } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import { selectRulesForAgent, cloneHardRulesTo, cloneSafetyRulesTo } from "@/lib/agent-policy";

type AgentOption = { id: string; name: string };
type HardRule = {
  id: string; rule_text: string; action_type_pattern: string;
  effect: "always_block" | "always_require_approval"; provider: string | null;
  shadow_mode: boolean; enabled: boolean; agent_id: string | null;
};
type SafetyRule = {
  id: string; name: string; category: string; pattern: string;
  severity: "block" | "require_approval"; enabled: boolean; agent_id: string | null;
};

const DEFAULT_CAP = 5;

/**
 * EFFECTIVE POLICY PER AGENT — a read-only summary of what actually
 * applies to ONE agent right now, resolving agent-specific overrides
 * against the account-wide fallback the same way the real control gate
 * does (selectRulesForAgent), instead of making the customer merge
 * account-wide + per-agent settings in their head. Also lets you clone an
 * agent's own rules to a different agent as a starting point (Wave 5
 * session 1 leftovers, closed out).
 */
export default function ControlAgentPolicy() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId, role } = useActiveAccount();
  const canWrite = canWriteAsOwner(role);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("");
  const [cloneTargetId, setCloneTargetId] = useState("");
  const [cloning, setCloning] = useState(false);

  const [hardRules, setHardRules] = useState<HardRule[]>([]);
  const [safetyRules, setSafetyRules] = useState<SafetyRule[]>([]);
  const [strictness, setStrictness] = useState<{ value: string; isOverride: boolean }>({ value: "balanced", isOverride: false });
  const [spendCap, setSpendCap] = useState<{ cap: number; hasOwnCap: boolean }>({ cap: DEFAULT_CAP, hasOwnCap: false });

  const load = useCallback(async () => {
    if (!accountId) return;
    const { data: agentRows } = await supabase.from("agents").select("id, name").eq("user_id", accountId).order("name");
    setAgents((agentRows ?? []) as AgentOption[]);
    if (!agentId) return;

    const [{ data: hr }, { data: sr }, { data: profile }, { data: override }, { data: cap }] = await Promise.all([
      supabase.from("hard_rules").select("id, rule_text, action_type_pattern, effect, provider, shadow_mode, enabled, agent_id").eq("user_id", accountId),
      supabase.from("safety_rules").select("id, name, category, pattern, severity, enabled, agent_id").eq("user_id", accountId),
      supabase.from("profiles").select("control_strictness").eq("id", accountId).maybeSingle(),
      supabase.from("agent_strictness_overrides").select("strictness").eq("agent_id", agentId).maybeSingle(),
      supabase.from("ai_spend_caps").select("daily_cap_usd").eq("user_id", accountId).eq("agent_id", agentId).maybeSingle(),
    ]);

    setHardRules((hr ?? []) as HardRule[]);
    setSafetyRules((sr ?? []) as SafetyRule[]);
    const overrideValue = (override as { strictness?: string } | null)?.strictness;
    const accountValue = (profile as { control_strictness?: string } | null)?.control_strictness ?? "balanced";
    setStrictness({ value: overrideValue ?? accountValue, isOverride: !!overrideValue });
    const capRow = cap as { daily_cap_usd?: number } | null;
    setSpendCap({ cap: Number(capRow?.daily_cap_usd ?? DEFAULT_CAP), hasOwnCap: !!capRow });
  }, [accountId, agentId]);

  useEffect(() => { void load(); }, [load]);

  const effectiveHardRules = selectRulesForAgent(hardRules, agentId || null).filter((r) => r.enabled !== false);
  const effectiveSafetyRules = selectRulesForAgent(safetyRules, agentId || null).filter((r) => r.enabled !== false);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Unknown agent";

  const clone = async () => {
    if (!canWrite || !agentId || !cloneTargetId || cloneTargetId === agentId) return;
    setCloning(true);
    const sourceHard = hardRules.filter((r) => r.agent_id === agentId);
    const sourceSafety = safetyRules.filter((r) => r.agent_id === agentId);
    const [hardRes, safetyRes] = await Promise.all([
      sourceHard.length
        ? supabase.from("hard_rules").insert(cloneHardRulesTo(sourceHard, accountId!, cloneTargetId))
        : Promise.resolve({ error: null }),
      sourceSafety.length
        ? supabase.from("safety_rules").insert(cloneSafetyRulesTo(sourceSafety, accountId!, cloneTargetId))
        : Promise.resolve({ error: null }),
    ]);
    setCloning(false);
    if (hardRes.error || safetyRes.error) {
      toast({ title: "Couldn't clone the policy", description: friendlyErrorMessage((hardRes.error || safetyRes.error)!.message), variant: "destructive" });
      return;
    }
    if (!sourceHard.length && !sourceSafety.length) {
      toast({ title: "Nothing to clone", description: `${agentName(agentId)} has no rules of its own (only account-wide ones apply to it).` });
      return;
    }
    toast({
      title: "Policy cloned",
      description: `${sourceHard.length} hard rule(s) and ${sourceSafety.length} safety rule(s) copied to ${agentName(cloneTargetId)}.`,
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

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Bot className="h-5 w-5 text-cyan-300" /> Effective policy per agent
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          What actually applies to one agent right now — agent-specific overrides resolved against the
          account-wide default, the same way the control gate resolves them. Read-only; change things
          from Hard rules, Safety rules, the spend cap, or strictness.
        </p>

        <div className="mt-6">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">Agent</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-none"
          >
            <option value="">Select an agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {agentId && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded border border-white/10 bg-white/[0.02] p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Strictness</div>
                <div className="mt-1 text-lg font-semibold capitalize">{strictness.value}</div>
                <div className="mt-1 text-xs text-zinc-500">{strictness.isOverride ? "This agent's own override" : "Using the account-wide default"}</div>
              </div>
              <div className="rounded border border-white/10 bg-white/[0.02] p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Daily spend cap</div>
                <div className="mt-1 text-lg font-semibold">${spendCap.cap.toFixed(2)}</div>
                <div className="mt-1 text-xs text-zinc-500">{spendCap.hasOwnCap ? "This agent's own cap" : "Using the account-wide default"}</div>
              </div>
            </div>

            <section className="mt-6">
              <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                Hard rules that apply ({effectiveHardRules.length})
              </h2>
              {effectiveHardRules.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">None — nothing explicitly governs this agent's actions.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {effectiveHardRules.map((r) => (
                    <li key={r.id} className={`rounded border px-3 py-2 text-sm ${r.shadow_mode ? "border-amber-500/25 bg-amber-500/[0.04]" : "border-white/10 bg-black/30"}`}>
                      <span className="text-zinc-200">{r.rule_text}</span>
                      <span className="ml-2 font-mono text-[11px] text-zinc-500">
                        {r.effect === "always_block" ? "always blocked" : "approval required"}
                        {" · "}
                        <span className={r.agent_id ? "text-cyan-400" : ""}>{r.agent_id ? "this agent" : "account-wide"}</span>
                        {r.shadow_mode && " · shadow (not enforced yet)"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6">
              <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                Safety rules that apply ({effectiveSafetyRules.length})
              </h2>
              {effectiveSafetyRules.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">No custom safety rules — the built-in checks still apply.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {effectiveSafetyRules.map((r) => (
                    <li key={r.id} className="rounded border border-white/10 bg-black/30 px-3 py-2 text-sm">
                      <span className="text-zinc-200">{r.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-zinc-500">
                        {r.severity === "block" ? "block" : "approval"}
                        {" · "}
                        <span className={r.agent_id ? "text-cyan-400" : ""}>{r.agent_id ? "this agent" : "account-wide"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canWrite && (
              <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <h2 className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-zinc-400">
                  <Copy className="h-3.5 w-3.5" /> Clone this agent's policy
                </h2>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Copies {agentName(agentId)}'s own hard rules and safety rules (not account-wide ones — those
                  already apply everywhere) as a starting point for another agent.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={cloneTargetId}
                    onChange={(e) => setCloneTargetId(e.target.value)}
                    className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300"
                  >
                    <option value="">To which agent…</option>
                    {agents.filter((a) => a.id !== agentId).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={clone}
                    disabled={cloning || !cloneTargetId}
                    className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-400 disabled:opacity-40"
                  >
                    <Copy className="h-3.5 w-3.5" /> {cloning ? "Cloning…" : "Clone"}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
