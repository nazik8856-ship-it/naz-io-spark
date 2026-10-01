import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;

export type PendingApprovalFeedItem = {
  id: string;
  description: string;
  action_type: string;
  risk_tier: string;
  created_at: string;
};

/**
 * Blueprint task #63 follow-up: the dashboard's right-dock chat panel needs
 * real, actionable pending-approval cards (not just a link to the full
 * page), per the reference mockup's inline Approve/Deny/Simulate buttons.
 * `resolve` calls the exact same `record_approval_signoff` RPC
 * ControlApprovals.tsx uses -- quorum, dual control and audit trail are all
 * enforced server-side by that one function, so this widget never needs to
 * reimplement any of that; it only needs to call it and show the result.
 */
export function usePendingApprovalsFeed(accountId: string | undefined) {
  const [approvals, setApprovals] = useState<PendingApprovalFeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, count } = await anyDb
      .from("pending_approvals")
      .select("id, description, action_type, risk_tier, created_at", { count: "exact" })
      .eq("user_id", accountId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5);
    setApprovals((data ?? []) as PendingApprovalFeedItem[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (id: string, vote: "approve" | "reject") => {
    setResolvingId(id);
    const { data, error } = await anyDb.rpc("record_approval_signoff", {
      _approval_id: id,
      _vote: vote,
      _comment: null,
    });
    setResolvingId(null);
    if (error) {
      toast({ title: "Couldn't save that", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    const res = (data ?? {}) as { status?: string; approvals?: number; required?: number; remaining?: number };
    const met = res.status === "approved" || res.status === "rejected";
    toast({
      title: met ? (res.status === "approved" ? "Approved" : "Rejected") : "Sign-off recorded",
      description: met ? undefined : `${res.approvals ?? 0} of ${res.required ?? 1} approvals — still needs ${res.remaining ?? 1} more.`,
    });
    await load();
  };

  return { approvals, total, loading, resolvingId, resolve, refetch: load };
}
