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
  status: "pending" | "approved";
  executed_at: string | null;
};

/**
 * Blueprint task #63 follow-up: the dashboard's right-dock chat panel needs
 * real, actionable pending-approval cards (not just a link to the full
 * page), per the reference mockup's inline Approve/Deny/Simulate buttons.
 * `resolve` calls the exact same `record_approval_signoff` RPC
 * ControlApprovals.tsx uses -- quorum, dual control and audit trail are all
 * enforced server-side by that one function, so this widget never needs to
 * reimplement any of that; it only needs to call it and show the result.
 *
 * Blueprint task #69: once quorum is met, carrying the action out is a
 * SEPARATE step (control-engine's /approvals/:id/execute, same as
 * ControlApprovals.tsx's "Run it" button) -- it is never automatic. The old
 * `status = "pending"`-only query made an approved-but-not-yet-executed row
 * simply vanish from this feed the moment quorum was met, which looked
 * exactly like "done" even though a human still had to go run it. Also
 * fetching `status = "approved" AND executed_at IS NULL` rows keeps them
 * visible (and counted in the mobile badge) until they're actually carried
 * out, instead of silently dropping that second step on the floor.
 */
export function usePendingApprovalsFeed(accountId: string | undefined) {
  const [approvals, setApprovals] = useState<PendingApprovalFeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, count } = await anyDb
      .from("pending_approvals")
      .select("id, description, action_type, risk_tier, created_at, status, executed_at", { count: "exact" })
      .eq("user_id", accountId)
      .or("status.eq.pending,and(status.eq.approved,executed_at.is.null)")
      .order("created_at", { ascending: false })
      .limit(8);
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
      title: met ? (res.status === "approved" ? "Approved — ready to run" : "Rejected") : "Sign-off recorded",
      description: met
        ? (res.status === "approved" ? "Quorum met. Click Run it to carry the action out." : undefined)
        : `${res.approvals ?? 0} of ${res.required ?? 1} approvals — still needs ${res.remaining ?? 1} more.`,
    });
    await load();
  };

  const execute = async (id: string) => {
    setExecutingId(id);
    const { data, error } = await supabase.functions.invoke(`control-engine/approvals/${id}/execute`, { body: {} });
    setExecutingId(null);
    const res = (data ?? {}) as { message?: string; summary?: string; executed?: boolean; already_executed?: boolean };
    if (error && !res.message) {
      toast({ title: "Couldn't run it", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({
      title: res.executed ? "Action carried out" : res.already_executed ? "Already done" : "Nothing ran",
      description: res.summary || res.message || "",
      variant: res.executed || res.already_executed ? undefined : "destructive",
    });
    await load();
  };

  return { approvals, total, loading, resolvingId, resolve, executingId, execute, refetch: load };
}
