// Inner Control page, top card: is this project governed, and what is the one thing to do next?
// A ring shows rule coverage, one line says how many rules are active, one button is the next step.
// Approvals and incidents appear only when something is waiting.
import type { ReactNode } from "react";
import { ChevronRight, Sparkles } from "lucide-react";

export type SetupCheck = { label: string; done: boolean; onClick: () => void };

const TICKS = 60;

/** Segmented ring: one tick per 1.67 %, the covered share lit, a bright dot at its end. */
export function CoverageRing({ pct }: { pct: number | null }) {
  const value = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const lit = Math.round((value / 100) * TICKS);
  const end = ((lit / TICKS) * 360 - 90) * (Math.PI / 180);
  const label = pct === null ? "Coverage not measured yet" : `Coverage ${value}%`;
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0 sm:h-32 sm:w-32" role="img" aria-label={label} data-testid="coverage-ring" data-lit={lit}>
      <defs>
        <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" /></filter>
        <radialGradient id="ring-core" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#0b2230" /><stop offset="100%" stopColor="#06101c" /></radialGradient>
      </defs>
      <circle cx="60" cy="60" r="40" fill="url(#ring-core)" stroke="rgba(34,211,238,0.18)" strokeWidth="1" />
      {Array.from({ length: TICKS }, (_, i) => {
        const a = (i / TICKS) * 2 * Math.PI - Math.PI / 2;
        const on = i < lit;
        return (
          <line key={i} x1={60 + 45 * Math.cos(a)} y1={60 + 45 * Math.sin(a)} x2={60 + 55 * Math.cos(a)} y2={60 + 55 * Math.sin(a)}
            stroke={on ? "#22d3ee" : "rgba(148,163,184,0.28)"} strokeWidth="2" strokeLinecap="round" opacity={on ? 0.35 + 0.65 * (i / Math.max(lit, 1)) : 1} />
        );
      })}
      {lit > 0 && (
        <>
          <circle cx={60 + 50 * Math.cos(end)} cy={60 + 50 * Math.sin(end)} r="5" fill="#67e8f9" filter="url(#ring-glow)" />
          <circle cx={60 + 50 * Math.cos(end)} cy={60 + 50 * Math.sin(end)} r="2.6" fill="#e0fbff" />
        </>
      )}
    </svg>
  );
}

export default function StatusHero({
  coveragePct, status, checks, cta, approvals = 0, incidents = 0, onApprovals, onIncidents, health,
}: {
  coveragePct: number | null;
  /** "3 rules active – Coverage 45%"; null while the rules load or when there are none. */
  status: string | null;
  /** The setup steps; the first one not done is the next step. */
  checks: SetupCheck[];
  /** With no rule at all, the one thing to do next. */
  cta?: { label: string; onClick: () => void } | null;
  approvals?: number;
  incidents?: number;
  onApprovals?: () => void;
  onIncidents?: () => void;
  /** The account's traffic light. */
  health?: ReactNode;
}) {
  const done = checks.filter((c) => c.done).length;
  const next = checks.find((c) => !c.done);
  const action = cta ?? (next ? { label: "Complete setup", onClick: next.onClick } : null);
  return (
    <section
      className="rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-400/[0.09] via-white/[0.02] to-transparent p-4 shadow-[0_0_28px_rgba(34,211,238,0.08)] sm:p-5"
      aria-label="Status" data-testid="setup-status"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-zinc-50">Status</h2>
        {health}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <CoverageRing pct={coveragePct} />
        <div className="min-w-0 flex-1">
          {cta ? (
            <p className="text-sm leading-snug text-cyan-100">No rules are active yet, so nothing limits what your AI may do.</p>
          ) : status ? (
            <p className="text-base font-medium leading-snug text-zinc-50" data-testid="status-line">{status}</p>
          ) : (
            <p className="text-sm text-zinc-500">Checking your rules…</p>
          )}
          {action && (
            <button
              onClick={action.onClick}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-black shadow-[0_0_20px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300"
              data-testid="hero-action"
            >
              {cta && <Sparkles className="h-4 w-4" />} {action.label}
            </button>
          )}
          {!cta && next && (
            <p className="mt-1.5 text-[11px] text-zinc-500" data-testid="setup-next">{done} of {checks.length} steps done · next: {next.label}</p>
          )}
        </div>
      </div>
      {(approvals > 0 || incidents > 0) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3" data-testid="attention">
          {approvals > 0 && (
            <button onClick={onApprovals} className="flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs text-amber-200 hover:bg-amber-400/20">
              Approvals waiting <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-black" data-testid="approvals-count">{approvals}</span><ChevronRight className="h-3 w-3" />
            </button>
          )}
          {incidents > 0 && (
            <button onClick={onIncidents} className="flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-400/10 px-3 py-1 text-xs text-rose-200 hover:bg-rose-400/20">
              Open incidents <span className="rounded-full bg-rose-400 px-1.5 text-[10px] font-bold text-black" data-testid="incidents-count">{incidents}</span><ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
