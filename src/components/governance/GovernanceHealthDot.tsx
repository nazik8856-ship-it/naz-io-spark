import type { GovernanceHealth } from "@/lib/governance-health";

// GAP 10 (Unified UX): the one traffic-light shown identically in the
// Generator header, the Control System header, and every Governed
// Entities row -- same dot, same tooltip convention, wherever it appears.
const DOT_CLASS: Record<GovernanceHealth["level"], string> = {
  green: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]",
  amber: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]",
  red: "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]",
};

const LABEL: Record<GovernanceHealth["level"], string> = {
  green: "Healthy",
  amber: "Needs attention",
  red: "At risk",
};

export default function GovernanceHealthDot({
  health,
  label,
  compact = false,
}: {
  health: GovernanceHealth;
  /** Override the default level label (e.g. to add a score alongside it). */
  label?: string;
  /** Dot only, no text -- for tight spaces like a table row. */
  compact?: boolean;
}) {
  const title = health.reasons.join(" ");
  if (compact) {
    return (
      <span title={title} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[health.level]}`} />
    );
  }
  return (
    <span title={title} className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[health.level]}`} />
      {label ?? LABEL[health.level]}
    </span>
  );
}
