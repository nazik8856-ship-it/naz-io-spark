// Outer Control page, section 1: is it working? One line of state, the trust score, and
// anything that needs attention behind a single click. Everything else is in "Advanced".
import { useState } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";
import { TONE_DOT } from "@/lib/outer-control-ui";

export type Attention = { id: string; message: string; actionLabel: string; onAction: () => void; busy?: boolean };

type Props = {
  trust: number | null;
  health: string;
  attention: Attention[];
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  onApiDocs: () => void;
};

export default function OuterStatusBar({ trust, health, attention, advancedOpen, onToggleAdvanced, onApiDocs }: Props) {
  const [showAttention, setShowAttention] = useState(false);
  const tone = attention.length ? "warn" : "ok";
  return (
    <section className="hud-glass rounded-2xl px-6 py-5" aria-label="Status" data-testid="status-bar">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-zinc-100">Outer Control is active</h1>
            <p className="mt-0.5 text-sm text-zinc-400" data-testid="health-text">{health}</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right" title="Average trust score of the replies checked in the last 7 days">
            <div className="text-3xl font-semibold leading-none text-zinc-100" data-testid="trust-score">{trust ?? "—"}</div>
            <div className="mt-1 text-xs text-zinc-500">Trust score</div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <button
              type="button"
              onClick={onToggleAdvanced}
              aria-expanded={advancedOpen}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> {advancedOpen ? "Hide advanced" : "Advanced"}
            </button>
            <button type="button" onClick={onApiDocs} className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
              API docs
            </button>
          </div>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3">
          <button
            type="button"
            onClick={() => setShowAttention((v) => !v)}
            aria-expanded={showAttention}
            className="flex items-center gap-1.5 text-sm text-amber-300 hover:text-amber-200"
          >
            {showAttention ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {attention.length} {attention.length === 1 ? "thing needs" : "things need"} attention
          </button>
          {showAttention && (
            <ul className="mt-2 space-y-2">
              {attention.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-300">
                  <span>{a.message}</span>
                  <button
                    type="button"
                    disabled={a.busy}
                    onClick={a.onAction}
                    className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-50"
                  >
                    {a.actionLabel}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
