import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CreditTransaction {
  id: string;
  user_id: string;
  type: "credit_pack" | "plan_change" | "promo" | string;
  description: string;
  amount: number;
  price_usd: number | null;
  status: string;
  created_at: string;
  metadata?: any;
}

export function useTransactions(userId: string | undefined) {
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) {
      setTransactions([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("credit_transactions" as any)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error && data) setTransactions(data as unknown as CreditTransaction[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`tx:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "credit_transactions", filter: `user_id=eq.${userId}` },
        () => fetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetch]);

  return { transactions, loading, refetch: fetch };
}
