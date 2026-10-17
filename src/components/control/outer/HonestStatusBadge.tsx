// Outer Control: the strict status label with its short reason (see src/lib/outer-control-status.ts).
import type { HonestStatus, StatusKey } from "@/lib/outer-control-status";

const STYLE: Record<StatusKey, string> = {
  completed: "border-emerald-500/40 text-emerald-300",
  partial: "border-orange-500/50 text-orange-300",
  failed: "border-rose-500/40 text-rose-300",
  waiting: "border-amber-500/50 text-amber-300",
  stopped: "border-zinc-400/40 text-zinc-300",
  running: "border-cyan-500/40 text-cyan-300",
  queued: "border-white/20 text-zinc-400",
};

export function HonestStatusBadge({ status, className = "" }: { status: HonestStatus; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${STYLE[status.key]} ${className}`} data-testid="status-badge" data-status={status.key}>
      {status.key === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" aria-hidden />}
      {status.label}
    </span>
  );
}

/** The reason sits next to every status that is not Completed. */
export function StatusReason({ status }: { status: HonestStatus }) {
  if (!status.reason) return null;
  return <p className={`text-xs ${status.key === "failed" ? "text-rose-300/90" : status.key === "partial" ? "text-orange-300/90" : "text-zinc-400"}`} data-testid="status-reason">{status.reason}</p>;
}
