import { useCallback, useEffect, useState } from "react";
import { Gauge, Check, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canWriteAsOwner } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import { projectMonthlySpend } from "@/lib/roi-report";

const DEFAULT_CAP = 5;
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

type AgentOption = { id: string; name: string };

/**
 * Daily AI-gateway spend: today's usage against a cap. Account-wide by
 * default ("All agents"); an agent with its own cap configured (Wave 5
 * session 1 — a separate, parallel mechanism, not a replacement for the
 * account-wide one) can be selected to view/manage that agent's own cap
 * instead. At 90% the system warns, at 100% it auto-trips a kill switch
 * scoped to whichever level tripped it (account-wide or just that agent)
 * until the next UTC day.
 */
export default function SpendCapPanel() {
  const { accountId, role } = useActiveAccount();
  const canWrite = canWriteAsOwner(role);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [scopeAgentId, setScopeAgentId] = useState("");
  const [hasCap, setHasCap] = useState(true); // account-wide always has a cap (auto-created); per-agent may not
  const [cap, setCap] = useState<number>(DEFAULT_CAP);
  const [enabled, setEnabled] = useState(true);
  const [spent, setSpent] = useState(0);
  const [calls, setCalls] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(DEFAULT_CAP));
  const [saving, setSaving] = useState(false);
  const [forecast, setForecast] = useState<number | null>(null);
  const [dualControl, setDualControl] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const daysElapsed = now.getUTCDate();

    const [{ data: agentRows }, capQuery, dailyQuery, monthQuery, { data: profile }] = await Promise.all([
      supabase.from("agents").select("id, name").eq("user_id", accountId).order("name"),
      scopeAgentId
        ? supabase.from("ai_spend_caps").select("daily_cap_usd, enabled").eq("user_id", accountId).eq("agent_id", scopeAgentId).maybeSingle()
        : supabase.from("ai_spend_caps").select("daily_cap_usd, enabled").eq("user_id", accountId).is("agent_id", null).maybeSingle(),
      scopeAgentId
        ? supabase.from("ai_spend_daily").select("cost_usd, calls").eq("user_id", accountId).eq("agent_id", scopeAgentId).eq("day", day).maybeSingle()
        : supabase.from("ai_spend_daily").select("cost_usd, calls").eq("user_id", accountId).eq("day", day).is("agent_id", null).maybeSingle(),
      scopeAgentId
        ? supabase.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).eq("agent_id", scopeAgentId).gte("day", monthStart)
        : supabase.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).is("agent_id", null).gte("day", monthStart),
      supabase.from("profiles").select("require_dual_control_for_policy").eq("id", accountId).maybeSingle(),
    ]);
    setAgents((agentRows ?? []) as AgentOption[]);
    setDualControl(!!(profile as { require_dual_control_for_policy?: boolean } | null)?.require_dual_control_for_policy);
    const capRow = capQuery.data;
    const usageRow = dailyQuery.data;
    const configured = scopeAgentId ? !!capRow : true; // account-wide always effectively configured (falls back to $5 default)
    setHasCap(configured);
    const c = Number(capRow?.daily_cap_usd ?? DEFAULT_CAP);
    setCap(c);
    setDraft(c.toFixed(2));
    setEnabled(capRow?.enabled ?? true);
    setSpent(Number(usageRow?.cost_usd ?? 0));
    setCalls(Number(usageRow?.calls ?? 0));
    setEditing(false);
    const monthCosts = ((monthQuery.data ?? []) as { cost_usd: number }[]).map((r) => Number(r.cost_usd) || 0);
    setForecast(configured ? projectMonthlySpend(monthCosts, daysElapsed, daysInMonth) : null);
  }, [accountId, scopeAgentId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!canWrite) return;
    const value = Number(draft);
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: "Enter a valid cap", description: "The daily cap must be more than $0.", variant: "destructive" });
      return;
    }
    if (dualControl) {
      setSaving(true);
      const { error } = await supabase.rpc("request_policy_change", {
        _change_type: "raise_spend_cap",
        _target_user_id: accountId,
        _agent_id: scopeAgentId || null,
        _new_value: { daily_cap_usd: value },
        _description: scopeAgentId ? `Set this agent's daily spend cap to ${money(value)}` : `Set the account-wide daily spend cap to ${money(value)}`,
      });
      setSaving(false);
      setEditing(false);
      if (error) {
        toast({ title: "Could not request this change", description: friendlyErrorMessage(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Change requested", description: "A second owner needs to approve this from Policy change requests before it applies." });
      return;
    }
    setSaving(true);
    // Two partial unique indexes back this table now (one account-wide row
    // per user, one per (user, agent)) instead of a single user_id PK, so a
    // plain upsert can no longer infer the right conflict target -- find the
    // row first, then update or insert explicitly.
    const findQuery = scopeAgentId
      ? supabase.from("ai_spend_caps").select("id").eq("user_id", accountId).eq("agent_id", scopeAgentId).maybeSingle()
      : supabase.from("ai_spend_caps").select("id").eq("user_id", accountId).is("agent_id", null).maybeSingle();
    const { data: existing } = await findQuery;
    const { error } = existing?.id
      ? await supabase.from("ai_spend_caps").update({ daily_cap_usd: value, enabled }).eq("id", existing.id)
      : await supabase.from("ai_spend_caps").insert({ user_id: accountId, agent_id: scopeAgentId || null, daily_cap_usd: value, enabled: true });
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save the cap", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    setCap(value);
    setHasCap(true);
    setEnabled(true);
    setEditing(false);
    toast({
      title: scopeAgentId ? "Agent spend cap updated" : "Daily AI spend cap updated",
      description: `Now ${money(value)} per day${scopeAgentId ? " for this agent" : ""}.`,
    });
  };

  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const color = pct >= 100 ? "#ef4444" : pct >= 90 ? "#f59e0b" : "#22c55e";

  return (
    <div className="px-6 py-3 border-b border-white/5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
          <Gauge className="h-3.5 w-3.5" />
          Daily AI spend
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {agents.length > 0 && (
            <select
              value={scopeAgentId}
              onChange={(e) => setScopeAgentId(e.target.value)}
              aria-label="Spend cap scope"
              className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-zinc-300 outline-none"
            >
              <option value="">All agents (account-wide)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2 text-xs">
            {hasCap ? (
              <>
                <span className="font-mono" style={{ color }}>
                  {money(spent)} / {money(cap)}
                </span>
                <span className="text-zinc-500">· {calls} calls today</span>
              </>
            ) : (
              <span className="text-zinc-500">No cap set for this agent — only the account-wide cap applies</span>
            )}
            {editing ? (
              <>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  inputMode="decimal"
                  aria-label={scopeAgentId ? "Agent daily AI spend cap in dollars" : "Daily AI spend cap in dollars"}
                  className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-mono text-zinc-100"
                />
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" />
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : canWrite ? (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10"
              >
                <Pencil className="h-3 w-3" />
                {hasCap ? "Edit cap" : "Set cap"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {hasCap && (
        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      )}

      {hasCap && forecast !== null && (
        <p className="text-[11px] text-zinc-500">
          Projected this month at the current daily rate: <span className="font-mono text-zinc-400">{money(forecast)}</span>
        </p>
      )}

      {hasCap && pct >= 90 && (
        <p className="text-[11px]" style={{ color }}>
          {pct >= 100
            ? scopeAgentId
              ? "Cap reached — this agent is halted until tomorrow (UTC) or until an owner turns it back on. Other agents on this account are unaffected."
              : "Cap reached — AI actions are halted until tomorrow (UTC) or until an owner turns the kill switch off."
            : scopeAgentId
              ? "Over 90% of this agent's own cap used today. At 100% only this agent stops."
              : "Over 90% of today's cap used. At 100% the kill switch trips automatically."}
        </p>
      )}
    </div>
  );
}
