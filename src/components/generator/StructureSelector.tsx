import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STRUCTURE_OPTIONS, type StructureId } from "@/lib/site-structures";

/**
 * Smart Structure Selector: four clear structures; the pick is sent to the
 * Generator, which is then held to that structure (not just prompted).
 */
export default function StructureSelector({
  value, onChange, disabled,
}: { value: StructureId; onChange: (id: StructureId) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Site structure" className="grid gap-3 sm:grid-cols-2">
      {STRUCTURE_OPTIONS.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-structure={opt.id}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn(
              "text-left rounded-xl border p-4 transition-all disabled:opacity-50",
              selected
                ? "border-purple-400/60 bg-purple-500/15 shadow-[0_0_24px_rgba(168,85,247,0.25)]"
                : "border-white/10 bg-white/[0.03] hover:border-white/30",
            )}
          >
            <div className="flex items-center justify-between gap-2 min-h-[20px]">
              <span className="text-sm font-semibold text-white">{opt.label}</span>
              {selected && <Check className="h-4 w-4 text-purple-300" />}
            </div>
            <p className="mt-1 text-xs text-zinc-300">{opt.blurb}</p>
            <p className="mt-2 text-[11px] text-zinc-500">Best for: {opt.bestFor}</p>
            <ul className="mt-2 space-y-0.5">
              {opt.includes.map((line) => (
                <li key={line} className="text-[11px] text-zinc-400">• {line}</li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}
