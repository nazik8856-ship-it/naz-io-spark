import { useEffect, useState } from "react";
import { Check, X, Loader2, Minus, Circle, ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import type { ExecStep } from "@/hooks/useExecutionLog";


/**
 * Multi-step live execution log — the shared replacement for generic spinners
 * across agent deploys, agent runs, website generation/edits and OAuth flows.
 * Each row reflects a real system phase and updates the moment it progresses.
 */
export default function ExecutionLog({
  steps,
  title = "Execution",
  accent = "#22d3ee",
  compact = false,
  className = "",
  theme = "dark",
}: {
  steps: ExecStep[];
  title?: string;
  accent?: string;
  compact?: boolean;
  className?: string;
  theme?: "dark" | "light";
}) {
  // 100ms tick keeps the active step's elapsed counter feeling instant.
  const [, force] = useState(0);
  const [openWhy, setOpenWhy] = useState<Record<string, boolean>>({});
  const hasActive = steps.some((s) => s.status === "active");
  useEffect(() => {
    if (!hasActive) return;
    const iv = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(iv);
  }, [hasActive]);


  if (!steps.length) return null;

  const doneCount = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <div
      className={`rounded-xl border ${theme === "light" ? "bg-zinc-50" : "bg-black/50"} ${compact ? "p-3" : "p-4"} ${className}`}
      style={{ borderColor: `${accent}33` }}
      role="log"
      aria-live="polite"
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono" style={{ color: accent }}>
          <span className={`h-1.5 w-1.5 rounded-full ${hasActive ? "animate-pulse" : ""}`} style={{ background: accent }} />
          {title}
        </div>
        <span className="text-[10px] font-mono text-zinc-500">
          {doneCount}/{steps.length}
        </span>
      </div>

      <div className={`h-0.5 w-full rounded-full overflow-hidden mb-3 ${theme === "light" ? "bg-zinc-200" : "bg-white/5"}`}>
        <div
          className="h-full transition-all duration-200"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${accent}, #a855f7)` }}
        />
      </div>

      <ol className="space-y-1.5">
        {steps.map((s) => {
          const elapsed =
            s.startedAt ? Math.max(0, (s.endedAt ?? Date.now()) - s.startedAt) : null;
          const tone =
            s.status === "done"
              ? theme === "light" ? "text-emerald-700" : "text-emerald-200"
              : s.status === "error"
              ? theme === "light" ? "text-red-600" : "text-red-300"
              : s.status === "active"
              ? theme === "light" ? "text-zinc-900" : "text-white"
              : s.status === "skipped"
              ? "text-zinc-500 line-through"
              : "text-zinc-500";
          return (
            <li key={s.id} className="flex items-start gap-2.5 text-xs font-mono">
              <span className="mt-0.5 shrink-0">
                {s.status === "done" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : s.status === "error" ? (
                  <X className="h-3.5 w-3.5 text-red-400" />
                ) : s.status === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: accent }} />
                ) : s.status === "skipped" ? (
                  <Minus className="h-3.5 w-3.5 text-zinc-600" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-zinc-700" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`${tone} break-words`}>{s.label}</span>
                {s.note && (
                  <span className="block text-[10px] text-zinc-500 break-words mt-0.5">{s.note}</span>
                )}
              </span>
              {elapsed !== null && (s.status === "active" || s.status === "done" || s.status === "error") && (
                <span className="shrink-0 text-[10px] text-zinc-600 tabular-nums">
                  {elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
