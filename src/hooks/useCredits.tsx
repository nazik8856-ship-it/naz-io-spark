import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useCredits(userId: string | undefined) {
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCredits = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    if (!error && data) {
      setCredits(data.credits);
    }
    setLoading(false);
  }, [userId]);

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
