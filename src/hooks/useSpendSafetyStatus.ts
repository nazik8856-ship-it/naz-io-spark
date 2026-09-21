import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;

const DEFAULT_CAP = 5;

export type SpendSafetyStatus = {
  loading: boolean;
  spentToday: number;
  cap: number;
  capIsCustom: boolean;
  pct: number;
  killSwitchOn: boolean;
  trippedBreakerCount: number;
  refetch: () => void;
};

/**
 * Pillar 1 ("Your AI can't bankrupt you") blast-radius summary, account-wide.
 * Shared between the compact badge on the main Control System page and the
 * full status tile on /control-system/spend-safety, so the two never drift.
 */
export function useSpendSafetyStatus(accountId: string | undefined): SpendSafetyStatus {
  const [loading, setLoading] = useState(true);
  const [spentToday, setSpentToday] = useState(0);
  const [cap, setCap] = useState(DEFAULT_CAP);
  const [capIsCustom, setCapIsCustom] = useState(false);
  const [killSwitchOn, setKillSwitchOn] = useState(false);
  const [trippedBreakerCount, setTrippedBreakerCount] = useState(0);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const day = new Date().toISOString().slice(0, 10);
    const [capRes, spendRes, killRes, breakerRes] = await Promise.all([
      anyDb.from("ai_spend_caps").select("daily_cap_usd").eq("user_id", accountId).is("agent_id", null).maybeSingle(),
      anyDb.from("ai_spend_daily").select("cost_usd").eq("user_id", accountId).eq("day", day).is("agent_id", null).maybeSingle(),
      anyDb.from("profiles").select("kill_switch").eq("id", accountId).maybeSingle(),
      anyDb.from("circuit_breakers").select("id", { count: "exact", head: true }).eq("user_id", accountId).eq("tripped", true),
    ]);
    setCap(Number(capRes.data?.daily_cap_usd ?? DEFAULT_CAP));
    setCapIsCustom(!!capRes.data);
    setSpentToday(Number(spendRes.data?.cost_usd ?? 0));
    setKillSwitchOn(Boolean(killRes.data?.kill_switch));
    setTrippedBreakerCount(breakerRes.count ?? 0);
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void load(); }, [load, tick]);

  const pct = cap > 0 ? Math.min(100, (spentToday / cap) * 100) : 0;

  return {
    loading,
    spentToday,
    cap,
    capIsCustom,
    pct,
    killSwitchOn,
    trippedBreakerCount,
    refetch: () => setTick((t) => t + 1),
  };
}
