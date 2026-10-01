// Blueprint task #63: the reference dashboard's right-side "Agent Status" /
// approvals panel. Reads the same `pending_approvals` table ControlApprovals.tsx
// owns -- this is a summary view with a link to the real page, not a
// reimplementation of sign-off (quorum, dual control, etc. all stay on that page).
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;

type MiniApproval = { id: string; description: string; action_type: string; risk_tier: string; created_at: string };

const RISK_STYLE: Record<string, string> = {
  critical: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  medium: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  low: "border-white/15 bg-white/5 text-zinc-400",
};

export default function PendingApprovalsMini({ accountId }: { accountId: string | undefined }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<MiniApproval[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [{ data, count }] = await Promise.all([
      anyDb
        .from("pending_approvals")
        .select("id, description, action_type, risk_tier, created_at", { count: "exact" })
        .eq("user_id", accountId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    setItems((data ?? []) as MiniApproval[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <Inbox className="h-3.5 w-3.5" />
          Pending approvals
        </div>
        {total > 0 && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">
            {total}
          </span>
        )}
      </div>
      <div className="mt-2.5 space-y-1.5">
        {loading && <p className="text-xs text-zinc-600">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-xs text-zinc-600">Nothing waiting on you right now.</p>
        )}
        {!loading &&
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate("/control-system/approvals")}
              className="flex w-full items-start gap-2 rounded-lg border border-white/5 bg-black/20 p-2 text-left transition hover:border-white/15"
            >
              <span
                className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                  RISK_STYLE[item.risk_tier] ?? RISK_STYLE.low
                }`}
              >
                {item.risk_tier}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{item.description || item.action_type}</span>
            </button>
          ))}
      </div>
      <button
        onClick={() => navigate("/control-system/approvals")}
        className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-md border border-white/10 bg-white/[0.03] py-1.5 text-[11px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
      >
        View all approvals
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
