import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import OnboardingArt from "@/components/onboarding/OnboardingArt";
import { FREE_LIMITS, LIMIT_EVENT, UPGRADE_PATH, limitCopy, type LimitDetail } from "@/lib/limit-window";

// The global limit window (docs/onboarding-windows.md, window set 2). Calm, not a penalty: it says what reached its free limit,
// what stays available, and when the allowance comes back. Only the new limited action was refused; nothing is locked.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // my_free_limits is not in the generated types

export type UsageRow = { label: string; used: number | null; limit: number | null; note?: string };

type LimitStatus = { limited?: boolean; used?: number; limit?: number };

/** my_free_limits() as rows for "View usage". An account without limits says so instead of showing a count. */
export function usageRows(data: unknown): UsageRow[] {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, LimitStatus | undefined>;
  const row = (label: string, st: LimitStatus | undefined, fallback: number): UsageRow =>
    st && st.limited === false
      ? { label, used: null, limit: null, note: "No monthly limit on this account" }
      : { label, used: typeof st?.used === "number" ? st.used : null, limit: typeof st?.limit === "number" ? st.limit : fallback };
  return [row("Control Tasks", d.control_task, FREE_LIMITS.control_task), row("New websites", d.website, FREE_LIMITS.website)];
}

function UsageBar({ row }: { row: UsageRow }) {
  const pct = row.used != null && row.limit ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0;
  return (
    <div className="space-y-1.5" data-testid="limit-usage-row">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-zinc-300">{row.label}</span>
        <span className="font-mono text-zinc-400">{row.note ?? (row.used == null ? "…" : `${row.used} / ${row.limit} this month`)}</span>
      </div>
      {!row.note && (
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-cyan-400/70 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** The window itself, without data loading (the preview page renders it with fixed values). */
export function LimitWindowView({ detail, open, onClose, onUpgrade, showUsage, onViewUsage, usage, credits }: {
  detail: LimitDetail;
  open: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  showUsage: boolean;
  onViewUsage: () => void;
  usage: UsageRow[] | null;
  credits?: number | null;
}) {
  const copy = limitCopy(detail);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md gap-0 overflow-hidden border-cyan-400/20 bg-[#030a17] p-0 text-white shadow-[0_0_70px_-24px_rgba(34,211,238,0.45)] sm:rounded-2xl"
        data-testid="limit-window"
        data-kind={detail.kind}
      >
        <div className="pointer-events-none absolute -left-20 -top-20 h-48 w-48 rounded-full bg-cyan-500/10 blur-[80px]" aria-hidden />
        <div className="relative px-6 pb-6 pt-7">
          <div className="flex items-start gap-4">
            <OnboardingArt kind="soft-progress" />
            <div className="min-w-0 pt-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">{copy.eyebrow}</div>
              <DialogTitle className="mt-1 text-lg font-semibold leading-snug tracking-tight">{copy.title}</DialogTitle>
              <DialogDescription className="mt-1.5 text-sm leading-relaxed text-zinc-400">{copy.body}</DialogDescription>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Still available</div>
            <ul className="space-y-1.5">
              {copy.available.map((a) => (
                <li key={a} className="flex items-center gap-2 text-[13px] text-zinc-300">
                  <Check className="h-3.5 w-3.5 shrink-0 text-cyan-300" /> {a}
                </li>
              ))}
            </ul>
            {copy.resets && <div className="mt-3 border-t border-white/[0.06] pt-2 text-xs text-zinc-500">{copy.resets} (UTC)</div>}
          </div>

          {showUsage && (
            <div className="mt-3 space-y-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.03] px-4 py-3" data-testid="limit-usage">
              {(usage ?? usageRows(null)).map((r) => <UsageBar key={r.label} row={r} />)}
              {credits != null && (
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-zinc-300">Credits left</span>
                  <span className="font-mono text-zinc-400">{credits}</span>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onViewUsage}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300 transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              data-testid="limit-view-usage"
            >
              {showUsage ? "Hide usage" : "View usage"}
            </button>
            <button
              type="button"
              onClick={onUpgrade}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-[#03121a] transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
              data-testid="limit-upgrade"
            >
              Upgrade to Pro <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted once in App: opens on the `nazai:limit` event from any page. */
export default function LimitWindow() {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<LimitDetail | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    const onLimit = (e: Event) => {
      const d = (e as CustomEvent<LimitDetail>).detail;
      if (!d?.kind) return;
      setDetail(d); setShowUsage(false); setUsage(null);
    };
    window.addEventListener(LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(LIMIT_EVENT, onLimit);
  }, []);

  const viewUsage = async () => {
    if (showUsage) { setShowUsage(false); return; }
    setShowUsage(true);
    try {
      const [{ data }, { data: auth }] = await Promise.all([anyDb.rpc("my_free_limits"), supabase.auth.getUser()]);
      setUsage(usageRows(data));
      const uid = auth?.user?.id;
      if (uid) {
        const { data: p } = await supabase.from("profiles").select("credits").eq("id", uid).maybeSingle();
        setCredits(typeof p?.credits === "number" ? p.credits : null);
      }
    } catch { setUsage(usageRows(null)); }
  };

  if (!detail) return null;
  return (
    <LimitWindowView
      detail={detail}
      open
      onClose={() => setDetail(null)}
      onUpgrade={() => { setDetail(null); navigate(UPGRADE_PATH); }}
      showUsage={showUsage}
      onViewUsage={viewUsage}
      usage={usage}
      credits={credits}
    />
  );
}
