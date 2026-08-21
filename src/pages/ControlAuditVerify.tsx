import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

type MismatchedRow = { id: string; created_at: string; decision: string };
type VerifyResult = {
  checked: number;
  verified: number;
  unsigned: number;
  mismatched_count: number;
  mismatched: MismatchedRow[];
  checked_at: string;
};

/**
 * AUDIT TRAIL VERIFICATION — every decision has been cryptographically
 * signed (server-side HMAC) since 2026-08-09, but until now nothing ever
 * checked it for more than one record at a time, and no customer-facing
 * tool existed at all. Recomputes the signature for every decision in a
 * range and reports whether the stored record still matches what was
 * actually signed at creation — proof the audit trail hasn't been
 * altered, not just a claim that it hasn't.
 */
export default function ControlAuditVerify() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const verify = async () => {
    if (!user) return;
    setVerifying(true);
    setResult(null);
    const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
    const { data, error } = await supabase.rpc("verify_decision_signatures_batch", {
      _from: fromIso, _to: toIso, _limit: 20000,
    });
    setVerifying(false);
    if (error) {
      toast({ title: "Couldn't verify", description: error.message, variant: "destructive" });
      return;
    }
    setResult(data as VerifyResult);
  };

  if (!user) return null;

  const allGood = result && result.mismatched_count === 0;

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck className="h-5 w-5 text-cyan-300" /> Audit trail verification
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every decision is signed with a server-side key when it's written. This recomputes that
          signature for every decision in the range and reports whether the record still matches —
          proof nothing has been altered since it was logged.
        </p>

        <div className="mt-6 flex flex-wrap items-end gap-2 rounded border border-white/10 bg-white/[0.02] p-3">
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            To
            <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200" />
          </label>
          <button
            disabled={verifying}
            onClick={verify}
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {verifying ? "Verifying…" : "Verify signatures"}
          </button>
        </div>

        {result && (
          <div className="mt-6 space-y-3">
            <div className={`flex items-center gap-2 rounded border p-4 ${allGood ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-rose-500/40 bg-rose-500/[0.04]"}`}>
              {allGood ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-rose-400" />}
              <div className="text-sm">
                <p className={allGood ? "text-emerald-300" : "text-rose-300"}>
                  {allGood ? "Every signed decision matches its original content." : `${result.mismatched_count} decision(s) don't match what was originally signed.`}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {result.checked} checked · {result.verified} verified · {result.unsigned} predate signing
                  {" · "}as of {new Date(result.checked_at).toLocaleString()}
                </p>
              </div>
            </div>

            {result.mismatched.length > 0 && (
              <ul className="space-y-2">
                {result.mismatched.map((m) => (
                  <li key={m.id} className="rounded border border-rose-500/30 bg-rose-500/[0.04] p-3 text-sm">
                    <p className="text-rose-200">{m.decision}</p>
                    <p className="mt-1 font-mono text-[10px] text-zinc-500">{m.id} · {new Date(m.created_at).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
