import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cleanCode, isCompleteCode, mfaErrorText, unverifiedFactors, verifiedTotp, type FactorLike } from "@/lib/mfa";

type Enrollment = { factorId: string; qr: string; secret: string };

/** Account settings: turn the authenticator-app step on or off. Once on, every sign-in asks for a code (AuthGuard), and owner/admin
 *  data in the database needs it too (docs/two-step-sign-in.md). */
export const MfaCard = () => {
  const [factors, setFactors] = useState<FactorLike[] | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      console.error("[mfa] listFactors failed:", listError.message);
      setFactors([]);
      return;
    }
    setFactors(((data?.all ?? []) as FactorLike[]).filter((f) => (f.factor_type ?? "totp") === "totp"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const on = verifiedTotp(factors).length > 0;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      // A setup that was started and never confirmed would block a new one: clear those first.
      for (const f of unverifiedFactors(factors)) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `NazAI ${new Date().toISOString().slice(0, 10)}` });
      if (enrollError || !data) {
        setError(mfaErrorText(enrollError?.message));
        return;
      }
      setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollment || !isCompleteCode(code) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code: cleanCode(code) });
      if (verifyError) {
        setError(mfaErrorText(verifyError.message));
        setCode("");
        return;
      }
      setEnrollment(null);
      setCode("");
      toast.success("Two-step sign-in is on", { description: "From now on, signing in asks for a code from your authenticator app." });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (enrollment) await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setCode("");
    setError(null);
    await load();
  };

  const turnOff = async () => {
    const factor = verifiedTotp(factors)[0];
    if (!factor || busy) return;
    if (!window.confirm("Turn off two-step sign-in? Your account will be protected by your sign-in method alone.")) return;
    setBusy(true);
    setError(null);
    try {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (unenrollError) {
        setError(mfaErrorText(unenrollError.message));
        return;
      }
      toast.success("Two-step sign-in is off");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-8 p-4 rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className={`w-5 h-5 ${on ? "text-emerald-400" : "text-zinc-500"}`} />
        <h2 className="text-lg font-semibold">Two-step sign-in</h2>
      </div>

      {factors === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
      ) : enrollment ? (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-zinc-400">
            1. Open an authenticator app (Google Authenticator, 1Password, Authy…) and scan this picture.
          </p>
          <img src={enrollment.qr} alt="Scan this code with your authenticator app" className="w-44 h-44 rounded-lg bg-white p-2 mx-auto" />
          <p className="text-xs text-zinc-500 break-all">
            Can't scan? Type this key into the app instead: <span className="font-mono text-zinc-300 select-all">{enrollment.secret}</span>
          </p>
          <p className="text-sm text-zinc-400">2. Type the 6-digit code the app shows now.</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            placeholder="123456"
            aria-label="6-digit code"
            className="w-full h-11 text-center text-xl tracking-[0.4em] font-mono bg-white/[0.03] border border-white/10 rounded-xl text-white placeholder:text-white/15 focus:outline-none focus:border-[#00A3FF]/40"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !isCompleteCode(code)}
              className="flex-1 h-11 rounded-xl text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "#00A3FF" }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Turn on
            </button>
            <button type="button" onClick={() => void cancel()} className="px-4 h-11 rounded-xl border border-white/10 text-sm text-zinc-300 hover:text-white">
              Cancel
            </button>
          </div>
        </form>
      ) : on ? (
        <>
          <p className="text-sm text-zinc-500 mb-4">
            On. Every sign-in asks for a code from your authenticator app. Keep that phone safe: without it you cannot sign in.
          </p>
          <button
            type="button"
            onClick={() => void turnOff()}
            disabled={busy}
            className="h-10 px-4 rounded-xl border border-white/10 text-sm text-zinc-300 hover:text-white disabled:opacity-40"
          >
            Turn off
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-500 mb-4">
            Add a code from an authenticator app to every sign-in. Recommended for any account that manages agents or connected tools.
          </p>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="h-11 px-5 rounded-xl text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-2"
            style={{ background: "#00A3FF" }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Set up
          </button>
        </>
      )}
      {error ? <p role="alert" className="text-sm text-red-400 mt-3">{error}</p> : null}
    </div>
  );
};
