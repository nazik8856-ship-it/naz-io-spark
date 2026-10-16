// Inner Control page, top section: is it set up, and is it on? Four real checks (the same
// signals the first-run nudges use) and one line of status. With no rules at all, a strong
// primary button replaces the status line.
import { Check, Sparkles } from "lucide-react";

export type SetupCheck = { label: string; done: boolean; onClick: () => void };

export default function SetupProgressBar({
  pct,
  checks,
  cta,
  status,
}: {
  pct: number;
  checks: SetupCheck[];
  /** Shown when no rule exists yet: the one thing to do next. */
  cta?: { label: string; onClick: () => void } | null;
  /** Shown when rules exist, e.g. "3 rules active – Coverage 60%". */
  status?: string | null;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" aria-label="Setup and status" data-testid="setup-status">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Setup &amp; status</h2>
        <span className="font-mono text-[10px] text-cyan-300">{pct}% set up</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
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

      {cta ? (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] p-4">
          <p className="min-w-[200px] flex-1 text-sm text-cyan-100">
            No rules are active yet, so nothing limits what your AI may do. Start from a ready-made policy and change it afterwards.
          </p>
          <button
            onClick={cta.onClick}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-cyan-300/60 bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-black shadow-[0_0_20px_rgba(34,211,238,0.35)] transition hover:bg-cyan-300"
          >
            <Sparkles className="h-4 w-4" /> {cta.label}
          </button>
        </div>
      ) : status ? (
        <p className="mt-3 text-sm font-medium text-zinc-100" data-testid="status-line">{status}</p>
      ) : null}
    </section>
  );
}
