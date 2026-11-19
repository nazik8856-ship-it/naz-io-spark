// Conflict and duplicate warnings for a rule being added (Inner Control Day 2, #170). A warning only: Save stays open.
import { AlertTriangle } from "lucide-react";
import type { RuleWarning } from "@/lib/new-rule-warnings";

const TITLE: Record<RuleWarning["kind"], string> = { duplicate: "Already there", contradicts: "Disagrees with a rule", overlaps: "Overlaps a rule" };

export default function RuleWarnings({ warnings }: { warnings: RuleWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3" data-testid="rule-warnings">
      {warnings.map((w) => (
        <p key={`${w.kind}:${w.id}`} className="flex gap-2 text-xs text-amber-100" data-testid={`rule-warning-${w.kind}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span><span className="font-semibold">{TITLE[w.kind]}.</span> {w.line}</span>
        </p>
      ))}
      <p className="text-[11px] text-zinc-400">You can still save it.</p>
    </div>
  );
}
