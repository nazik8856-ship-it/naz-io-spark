import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Stage = "structure" | "content" | "polish";
const STEPS: { id: Stage; label: string }[] = [
  { id: "structure", label: "Structure" },
  { id: "content", label: "Content" },
  { id: "polish", label: "Visual polish" },
];

/**
 * Progressive refinement: Structure → Content → Visual polish. `current` is
 * the stage the user is working on; earlier ones show as done. `done` marks
 * the whole flow finished (every step checked).
 */
export default function StageStepper({ current, done = false, className }: { current: Stage; done?: boolean; className?: string }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <ol aria-label="Generation stages" className={cn("flex items-center gap-2 text-xs", className)}>
      {STEPS.map((s, i) => {
        const complete = done || i < idx;
        const active = !done && i === idx;
        return (
          <li key={s.id} data-stage={s.id} data-state={complete ? "done" : active ? "active" : "todo"} className="flex items-center gap-2">
            <span className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
              complete ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300" : active ? "border-purple-400/70 bg-purple-500/20 text-purple-200" : "border-white/15 text-zinc-500",
            )}>
              {complete ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={cn(complete ? "text-zinc-300" : active ? "text-white font-medium" : "text-zinc-500")}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-white/10" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
