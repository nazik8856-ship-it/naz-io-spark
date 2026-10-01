// Blueprint task #63 follow-up: pending approvals rendered as real,
// actionable chat-feed cards (Approve / Deny / Simulate) instead of a
// separate bordered list -- the reference mockup shows exactly this,
// approvals as part of the Agent Status conversation. Approve/Deny call the
// same record_approval_signoff RPC the full Approvals page uses (quorum and
// dual control enforced server-side); Simulate goes to the real rule
// simulator since testing a hypothetical variant of a pending action is
// what that page is for, not something this card re-implements.
import { useNavigate } from "react-router-dom";
import { Check, X, FlaskConical, Loader2 } from "lucide-react";
import type { PendingApprovalFeedItem } from "@/hooks/usePendingApprovalsFeed";

const RISK_STYLE: Record<string, string> = {
  critical: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  medium: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  low: "border-white/15 bg-white/5 text-zinc-400",
};

export default function ApprovalChatCard({
  approval,
  canSignOff,
  resolving,
  onResolve,
}: {
  approval: PendingApprovalFeedItem;
  canSignOff: boolean;
  resolving: boolean;
  onResolve: (vote: "approve" | "reject") => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="w-full">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${RISK_STYLE[approval.risk_tier] ?? RISK_STYLE.low}`}>
          {approval.risk_tier}
        </span>
        <p className="min-w-0 text-sm text-zinc-100">{approval.description || approval.action_type}</p>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {canSignOff ? (
          <>
            <button
              onClick={() => onResolve("approve")}
              disabled={resolving}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Approve
            </button>
            <button
              onClick={() => onResolve("reject")}
              disabled={resolving}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              Deny
            </button>
          </>
        ) : (
          <button
            onClick={() => navigate("/control-system/approvals")}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
          >
            View in Approvals
          </button>
        )}
        <button
          onClick={() => navigate("/control-system/simulator")}
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-3 py-1 text-xs font-medium text-cyan-300 transition hover:bg-cyan-500/15"
        >
          <FlaskConical className="h-3 w-3" />
          Simulate
        </button>
      </div>
    </div>
  );
}
