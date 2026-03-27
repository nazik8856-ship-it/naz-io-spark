import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useCredits(userId: string | undefined) {
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const ensureProfile = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (!data) {
      await supabase.from("profiles").insert({ id: userId, credits: 3 });
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

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  const deductCredit = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const { data, error } = await supabase.rpc("deduct_credit", { user_id: userId });
    if (error || !data) return false;
    await fetchCredits();
    return true;
  }, [userId, fetchCredits]);

  return { credits, loading, deductCredit, refetchCredits: fetchCredits };
}
