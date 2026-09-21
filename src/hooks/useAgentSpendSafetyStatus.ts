import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;

const DEFAULT_CAP = 5;

export type AgentSpendSafetyStatus = {
  loading: boolean;
  spentToday: number;
  cap: number;
  capIsAgentOwn: boolean;
  pct: number;
  agentKillSwitchOn: boolean;
  accountKillSwitchOn: boolean;
  trippedBreakerCount: number;
};

/**
 * Same Pillar 1 signals as useSpendSafetyStatus, scoped to ONE agent --
 * this agent's own cap if it has one (else the account-wide default),
 * this agent's own kill switch, the account-wide kill switch (which stops
 * every agent, including this one), and breakers tripped for this agent
 * specifically. Powers the status strip on the agent's own dashboard so an
 * owner doesn't have to leave it to see whether their agent is anywhere
 * near its limits.
 */
export function useAgentSpendSafetyStatus(accountId: string | undefined, agentId: string | undefined): AgentSpendSafetyStatus {
  const [loading, setLoading] = useState(true);
  const [spentToday, setSpentToday] = useState(0);
  const [cap, setCap] = useState(DEFAULT_CAP);
  const [capIsAgentOwn, setCapIsAgentOwn] = useState(false);
  const [agentKillSwitchOn, setAgentKillSwitchOn] = useState(false);
  const [accountKillSwitchOn, setAccountKillSwitchOn] = useState(false);
  const [trippedBreakerCount, setTrippedBreakerCount] = useState(0);

  const load = useCallback(async () => {
    if (!accountId || !agentId) return;
    setLoading(true);
    const day = new Date().toISOString().slice(0, 10);
    const [agentCapRes, accountCapRes, agentSpendRes, accountSpendRes, agentRes, profileRes, breakerRes] = await Promise.all([
      anyDb.from("ai_spend_caps").select("daily_cap_usd").eq("user_id", accountId).eq("agent_id", agentId).maybeSingle(),
      anyDb.from("ai_spend_caps").select("daily_cap_usd").eq("user_id", accountId).is("agent_id", null).maybeSingle(),
      anyDb.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).eq("agent_id", agentId).eq("day", day).maybeSingle(),
      anyDb.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).is("agent_id", null).eq("day", day).maybeSingle(),
      anyDb.from("agents").select("kill_switch").eq("id", agentId).maybeSingle(),
      anyDb.from("profiles").select("kill_switch").eq("id", accountId).maybeSingle(),
      anyDb.from("circuit_breakers").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("agent_id", agentId).eq("tripped", true),
    ]);
    const hasOwnCap = !!agentCapRes.data;
    setCapIsAgentOwn(hasOwnCap);
    setCap(Number((hasOwnCap ? agentCapRes.data?.daily_cap_usd : accountCapRes.data?.daily_cap_usd) ?? DEFAULT_CAP));
    setSpentToday(Number((hasOwnCap ? agentSpendRes.data?.cost_usd : accountSpendRes.data?.cost_usd) ?? 0));
    setAgentKillSwitchOn(Boolean(agentRes.data?.kill_switch));
    setAccountKillSwitchOn(Boolean(profileRes.data?.kill_switch));
    setTrippedBreakerCount(breakerRes.count ?? 0);
    setLoading(false);
  }, [accountId, agentId]);

  useEffect(() => { void load(); }, [load]);

  const pct = cap > 0 ? Math.min(100, (spentToday / cap) * 100) : 0;

  return { loading, spentToday, cap, capIsAgentOwn, pct, agentKillSwitchOn, accountKillSwitchOn, trippedBreakerCount };
}
