import { CheckCircle2, CircleDashed, Loader2, TriangleAlert, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QualityCheck } from "@/lib/site-structures";

const STATUS_STYLE: Record<QualityCheck["status"], { icon: typeof CheckCircle2; text: string; label: string }> = {
  pending: { icon: CircleDashed, text: "text-zinc-500", label: "Waiting" },
  checking: { icon: Loader2, text: "text-cyan-300", label: "Checking" },
  passed: { icon: CheckCircle2, text: "text-emerald-300", label: "Passed" },
  fixed: { icon: Wrench, text: "text-sky-300", label: "Fixed" },
  flagged: { icon: TriangleAlert, text: "text-amber-300", label: "Review" },
};

/**
 * Live Quality Preview Strip: the four generation checks and their real
 * state. Purely presentational -- the states come from the server
 * (generation_progress.checks / the response's quality_checks).
 */
export default function QualityStrip({ checks, className, compact = false }: { checks: QualityCheck[]; className?: string; compact?: boolean }) {
  return (
    <ul
      aria-label="Generation quality checks"
      className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4", className)}
    >
      {checks.map((c) => {
        const s = STATUS_STYLE[c.status];
        const Icon = s.icon;
        return (
          <li
            key={c.id}
            data-check={c.id}
            data-status={c.status}
            title={c.detail || s.label}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 min-w-0"
          >
            <div className="flex items-center gap-2 text-xs text-zinc-200">
              <Icon className={cn("h-3.5 w-3.5 shrink-0", s.text, c.status === "checking" && "animate-spin")} />
              <span className="truncate">{c.label}</span>
              <span className={cn("ml-auto text-[10px] font-mono uppercase tracking-wider shrink-0", s.text)}>{s.label}</span>
            </div>
            {c.detail && c.status !== "pending" && c.status !== "checking" && (
              <p className="mt-1 text-[11px] leading-snug text-zinc-400 line-clamp-2">{c.detail}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
