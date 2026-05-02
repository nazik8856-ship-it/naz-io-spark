import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  TIER_PLANS,
  TierId,
  getStoredTier,
  setStoredTier,
} from "@/lib/credit-tiers";

/**
 * useCredits — single source of truth for the user's remaining credit balance,
 * monthly limit, and tier. Synchronizes across tabs/sessions via Supabase
 * Realtime on `profiles` and a same-tab CustomEvent for tier changes.
 */
export function useCredits(userId: string | undefined) {
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<TierId>(() => getStoredTier());
  const [loading, setLoading] = useState(true);

  const plan = TIER_PLANS[tier];
  const monthlyLimit = plan.monthlyCredits;
  // Used = limit - remaining (clamped to ≥0). For Enterprise (limit 0), keep null.
  const used =
    credits == null || plan.isCustom ? null : Math.max(0, monthlyLimit - credits);

  const ensureProfile = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (!data) {
      // New users start with the Explorer monthly allotment.
      await supabase
        .from("profiles")
        .insert({ id: userId, credits: TIER_PLANS.explorer.monthlyCredits });
    }
  }, [userId]);

  const fetchCredits = useCallback(async () => {
    if (!userId) return;
    await ensureProfile();
    const { data, error } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    if (!error && data) {
      setCredits(data.credits ?? 0);
    } else {
      setCredits(0);
    }
    setLoading(false);
  }, [userId, ensureProfile]);

  // Initial fetch.
  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // Cross-session realtime: any update to this user's profile row updates the
  // local balance (e.g. a deduction on another tab or a server-side top-up).
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`profiles:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        (payload: any) => {
          const next = payload?.new?.credits;
          if (typeof next === "number") setCredits(next);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Same-tab tier sync (Buy Credits modal etc.).
  useEffect(() => {
    const onTier = (e: Event) => {
      const detail = (e as CustomEvent).detail as TierId | undefined;
      if (detail) setTier(detail);
    };
    window.addEventListener("nazai:tier-changed", onTier);
    return () => window.removeEventListener("nazai:tier-changed", onTier);
  }, []);

  const deductCredit = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const { data, error } = await supabase.rpc("deduct_credit", { user_id: userId });
    if (error || !data) return false;
    await fetchCredits();
    return true;
  }, [userId, fetchCredits]);

  const upgradeTier = useCallback((next: TierId) => {
    setTier(next);
    setStoredTier(next);
  }, []);

  return {
    credits,
    used,
    monthlyLimit,
    tier,
    plan,
    loading,
    deductCredit,
    refetchCredits: fetchCredits,
    upgradeTier,
  };
}
