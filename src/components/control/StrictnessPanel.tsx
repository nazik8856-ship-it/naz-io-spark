import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canWriteAsOwner } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";

type Strictness = "loose" | "balanced" | "strict";
type AgentOption = { id: string; name: string };

const OPTIONS: { value: Strictness; label: string; blurb: string }[] = [
  { value: "loose", label: "Loose", blurb: "More runs on its own, fewer stops for you." },
  { value: "balanced", label: "Balanced", blurb: "Escalates low-confidence and high-risk work." },
  { value: "strict", label: "Strict", blurb: "Narrow confidence bands, unclear fit gets parked." },
];

/**
 * STRICTNESS — one dial that scales risk scoring, fit scoring and the
 * confidence-escalation gate. Account-wide by default; an agent with its
 * own override (Wave 5 session 1, closed out) can be selected to view/
 * set that agent's own value instead — a separate, parallel mechanism,
 * not a replacement for the account-wide default every other agent still
 * uses.
 */
export default function StrictnessPanel() {
  const { user } = useAuth();
  const { accountId, role } = useActiveAccount();
  const canWrite = canWriteAsOwner(role);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [scopeAgentId, setScopeAgentId] = useState("");
  const [value, setValue] = useState<Strictness>("balanced");
  const [hasOverride, setHasOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dualControl, setDualControl] = useState(false);

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    const [{ data: agentRows }, { data: profile }, { data: override }] = await Promise.all([
      anyDb.from("agents").select("id, name").eq("user_id", accountId).order("name"),
      anyDb.from("profiles").select("control_strictness, require_dual_control_for_policy").eq("id", accountId).maybeSingle(),
      scopeAgentId
        ? anyDb.from("agent_strictness_overrides").select("strictness").eq("agent_id", scopeAgentId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setAgents((agentRows ?? []) as AgentOption[]);
    const accountValue = (profile as { control_strictness?: string } | null)?.control_strictness;
    setDualControl(!!(profile as { require_dual_control_for_policy?: boolean } | null)?.require_dual_control_for_policy);
    const overrideValue = (override as { strictness?: string } | null)?.strictness;
    setHasOverride(!!overrideValue);
    const v = overrideValue ?? accountValue;
    if (v === "loose" || v === "strict" || v === "balanced") setValue(v);
    else setValue("balanced");
  }, [user, accountId, scopeAgentId]);

  useEffect(() => { void load(); }, [load]);

  const pick = async (next: Strictness) => {
    if (!user || !canWrite || (next === value && (scopeAgentId ? hasOverride : true))) return;

    if (dualControl) {
      setSaving(true);
      const { error } = await anyDb.rpc("request_policy_change", {
        _change_type: "change_strictness",
        _target_user_id: accountId,
        _agent_id: scopeAgentId || null,
        _new_value: { strictness: next },
        _description: scopeAgentId ? `Set this agent's strictness to ${next}` : `Set account-wide strictness to ${next}`,
      });
      setSaving(false);
      if (error) {
        toast({ title: "Could not request this change", description: friendlyErrorMessage(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Change requested", description: "A second owner needs to approve this from Policy change requests before it applies." });
      return;
    }

    const prev = value;
    setValue(next);
    setSaving(true);
    const { error } = scopeAgentId
      ? await anyDb.from("agent_strictness_overrides").upsert(
          { agent_id: scopeAgentId, user_id: accountId, strictness: next },
          { onConflict: "agent_id" },
        )
      : await anyDb.from("profiles").update({ control_strictness: next } as never).eq("id", accountId);
    setSaving(false);
    if (error) {
      setValue(prev);
      toast({ title: "Couldn't save that", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    if (scopeAgentId) setHasOverride(true);
    toast({
      title: `Strictness: ${next}`,
      description: scopeAgentId ? "Applies to this agent's decisions from now on." : "Applies to every decision from now on.",
    });
  };

  const clearOverride = async () => {
    if (!scopeAgentId || !canWrite) return;
    const { error } = await anyDb.from("agent_strictness_overrides").delete().eq("agent_id", scopeAgentId);
    if (error) {
      toast({ title: "Couldn't clear the override", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    setHasOverride(false);
    void load();
    toast({ title: "Override cleared", description: "This agent now uses the account-wide default." });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-6 py-2 text-[11px]">
      <span className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-zinc-400">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Strictness
      </span>
      {agents.length > 0 && (
        <select
          value={scopeAgentId}
          onChange={(e) => setScopeAgentId(e.target.value)}
          aria-label="Strictness scope"
          className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono uppercase tracking-wider text-zinc-300"
        >
          <option value="">All agents (account-wide)</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      )}
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => pick(o.value)}
          disabled={saving || !canWrite}
          title={canWrite ? o.blurb : "Only the account owner or a team owner can change this."}
          className={`rounded border px-2.5 py-1 font-mono uppercase tracking-wider disabled:opacity-50 ${
            value === o.value
              ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
              : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
          }`}
        >
          {o.label}
        </button>
      ))}
      <span className="text-zinc-500">{OPTIONS.find((o) => o.value === value)?.blurb}</span>
      {scopeAgentId && hasOverride && (
        <button
          onClick={clearOverride}
          disabled={!canWrite}
          className="rounded border border-white/15 px-2 py-0.5 font-mono uppercase tracking-wider text-zinc-500 hover:bg-white/10 disabled:opacity-50"
        >
          Use account default
        </button>
      )}
      {scopeAgentId && !hasOverride && (
        <span className="text-zinc-600">(using account default — pick a value above to override just this agent)</span>
      )}
    </div>
  );
}
