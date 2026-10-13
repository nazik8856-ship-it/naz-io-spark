// Blueprint task #63: the reference dashboard's Setup Progress bar. Every
// checklist item reflects a real, already-checked signal (the same ones
// ControlSystem.tsx's existing first-run nudges use for hard/safety rules
// and the spend cap) -- not a fabricated onboarding step.
import { Check, Sparkles } from "lucide-react";

export type SetupCheck = { label: string; done: boolean; onClick: () => void };

export default function SetupProgressBar({
  pct,
  checks,
  cta,
}: {
  pct: number;
  checks: SetupCheck[];
  /** Mockup fidelity (task #67): the policy-template call to action lives inside this card, not in a separate banner. */
  cta?: { label: string; onClick: () => void } | null;
}) {
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
      {cta && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] px-3 py-2">
          <Sparkles className="h-4 w-4 shrink-0 text-cyan-300" />
          <p className="min-w-[180px] flex-1 text-xs text-cyan-100">
            No hard rules or safety rules yet — start from a policy template so your AI has real guardrails from day one.
          </p>
          <button
            onClick={cta.onClick}
            className="shrink-0 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
          >
            {cta.label}
          </button>
        </div>
      )}
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
