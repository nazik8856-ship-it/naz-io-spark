import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  TIER_PLANS,
  TIER_ORDER,
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
      .select("credits, tier")
      .eq("id", userId)
      .single();
    if (!error && data) {
      setCredits(data.credits ?? 0);
      // profiles.tier is server-authoritative (only purchase-credits, running
      // with the service role, ever writes it). Resync it into local state
      // and the localStorage cache on every fetch -- this is what actually
      // overwrites a tampered localStorage value with the real one, since
      // feature-gates.ts's useTier() picks up the change via the
      // nazai:tier-changed event setStoredTier dispatches.
      const serverTier = data.tier as string | null | undefined;
      if (serverTier && (TIER_ORDER as string[]).includes(serverTier)) {
        setTier(serverTier as TierId);
        setStoredTier(serverTier as TierId);
      }
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
  //
  // Channel name includes a random suffix -- this hook is called from more
  // than one component at once (CreditBalance, PaymentWindow), and
  // supabase.channel(topic) returns the SAME channel object for a repeated
  // topic string rather than a fresh one. A second .on() call on a channel
  // the first instance already .subscribe()'d throws ("cannot add
  // `postgres_changes` callbacks ... after `subscribe()`"), which crashed
  // /generator-home into the app's top-level ErrorBoundary in production.
  // The suffix only needs to be unique per mounted instance -- the filter
  // below is what actually scopes which row's changes this listens to, not
  // the channel name.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`profiles:${userId}:${Math.random().toString(36).slice(2)}`)
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
          const nextTier = payload?.new?.tier;
          if (typeof nextTier === "string" && (TIER_ORDER as string[]).includes(nextTier)) {
            setTier(nextTier as TierId);
            setStoredTier(nextTier as TierId);
          }
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

  return {
    credits,
    used,
    monthlyLimit,
    tier,
    plan,
    loading,
    deductCredit,
    refetchCredits: fetchCredits,
  };
}
