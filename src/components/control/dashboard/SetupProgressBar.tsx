// Blueprint task #63: the reference dashboard's Setup Progress bar. Every
// checklist item reflects a real, already-checked signal (the same ones
// ControlSystem.tsx's existing first-run nudges use for hard/safety rules
// and the spend cap) -- not a fabricated onboarding step.
import { Check } from "lucide-react";

export type SetupCheck = { label: string; done: boolean; onClick: () => void };

export default function SetupProgressBar({ pct, checks }: { pct: number; checks: SetupCheck[] }) {
  if (pct >= 100) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Setup progress</span>
        <span className="font-mono text-[10px] text-cyan-300">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg, #00f2ff, #d4af37)" }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {checks.map((c) => (
          <button
            key={c.label}
            onClick={c.onClick}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
              c.done
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/15 bg-white/5 text-zinc-400 hover:bg-white/10"
            }`}
          >
            <span
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-full ${c.done ? "bg-emerald-500/30" : "bg-white/10"}`}
            >
              {c.done && <Check className="h-2.5 w-2.5" />}
            </span>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
