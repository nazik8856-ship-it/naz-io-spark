import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquareHeart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FEEDBACK_REASONS } from "@/lib/onboarding-windows";

// "Was this useful?" answers after the first controlled Task (docs/onboarding-windows.md). An operator page for the platform's
// owners and admins: the totals and the latest answers, never who gave them. The database functions refuse anyone else.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // the feedback functions are not in the generated types

type SummaryRow = { answer: string; reason: string | null; accounts: number };
type RecentRow = { created_at: string; answer: string; reason: string | null };

const REASON_LABEL: Record<string, string> = Object.fromEntries(FEEDBACK_REASONS.map((r) => [r.id, r.label]));
const ANSWER_LABEL: Record<string, string> = { useful: "Useful", not_useful: "Not really", skipped: "Skipped" };

/** Totals per answer, and the "Not really" reasons, from onboarding_feedback_summary(). */
export function feedbackTotals(rows: SummaryRow[]) {
  const by = (a: string) => rows.filter((r) => r.answer === a).reduce((n, r) => n + Number(r.accounts), 0);
  const useful = by("useful"), notUseful = by("not_useful"), skipped = by("skipped");
  const answered = useful + notUseful;
  const reasons = rows.filter((r) => r.answer === "not_useful")
    .map((r) => ({ label: r.reason ? REASON_LABEL[r.reason] ?? r.reason : "No reason given", accounts: Number(r.accounts) }))
    .sort((a, b) => b.accounts - a.accounts);
  return { useful, notUseful, skipped, answered, usefulPct: answered ? Math.round((useful / answered) * 100) : null, reasons };
}

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {note && <div className="mt-0.5 text-xs text-zinc-500">{note}</div>}
    </div>
  );
}

export default function OpsFeedback() {
  const { user } = useAuth();
  const [state, setState] = useState<"loading" | "denied" | "ready">("loading");
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);

  useEffect(() => {
    if (!user) { setState("denied"); return; }
    (async () => {
      const [s, r] = await Promise.all([anyDb.rpc("onboarding_feedback_summary"), anyDb.rpc("onboarding_feedback_recent", { _limit: 50 })]);
      if (s.error || r.error) { setState("denied"); return; }
      setSummary((s.data ?? []) as SummaryRow[]);
      setRecent((r.data ?? []) as RecentRow[]);
      setState("ready");
    })();
  }, [user]);

  const t = feedbackTotals(summary);
  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <MessageSquareHeart className="h-5 w-5 text-cyan-300" />
        <h1 className="text-lg font-semibold">Onboarding feedback</h1>
        <Link to="/ops/incidents" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">Platform incidents</Link>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {state === "loading" && <p className="text-sm text-zinc-500">Loading…</p>}
        {state === "denied" && <p className="text-sm text-zinc-400" data-testid="ops-feedback-denied">This page is for the platform's owners and admins.</p>}
        {state === "ready" && (
          <>
            <p className="text-sm text-zinc-400">
              Answers to "Was this useful?" after a new account's first controlled Task. One answer per account; who gave it is not shown.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="ops-feedback-totals">
              <Stat label="Useful" value={t.useful} note={t.usefulPct == null ? "no answers yet" : `${t.usefulPct}% of answers`} />
              <Stat label="Not really" value={t.notUseful} />
              <Stat label="Skipped" value={t.skipped} />
              <Stat label="Answered" value={t.answered} note="useful + not really" />
            </div>
            <section>
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Why "Not really"</h2>
              {t.reasons.length === 0 ? <p className="text-sm text-zinc-500">None yet.</p> : (
                <ul className="space-y-1.5">
                  {t.reasons.map((r) => (
                    <li key={r.label} className="flex justify-between rounded-lg border border-white/[0.06] px-3 py-2 text-sm">
                      <span className="text-zinc-300">{r.label}</span><span className="font-mono text-zinc-400">{r.accounts}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Latest answers</h2>
              {recent.length === 0 ? <p className="text-sm text-zinc-500">No answers yet.</p> : (
                <ul className="divide-y divide-white/5 rounded-xl border border-white/[0.06]" data-testid="ops-feedback-recent">
                  {recent.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className={r.answer === "useful" ? "text-cyan-200" : r.answer === "not_useful" ? "text-zinc-200" : "text-zinc-500"}>
                        {ANSWER_LABEL[r.answer] ?? r.answer}{r.reason ? ` · ${REASON_LABEL[r.reason] ?? r.reason}` : ""}
                      </span>
                      <span className="font-mono text-xs text-zinc-500">{new Date(r.created_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
