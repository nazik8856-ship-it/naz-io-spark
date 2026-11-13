import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cleanCode, cleanRecoveryInput, isCompleteCode, isCompleteRecoveryCode, mfaErrorText, recoveryErrorText, verifiedTotp } from "@/lib/mfa";
import { callRecovery } from "@/lib/mfa-recovery";

/**
 * Shown instead of the page when the person has an authenticator app set up and this sign-in has not used it yet.
 * A correct code lifts the session to aal2 and the page loads.
 */
export const MfaChallenge = ({ onDone }: { onDone: () => void }) => {
  const { signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "I lost my phone": a recovery code turns the authenticator app off so the person can sign in and set it up again.
  const [recovering, setRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  const submitRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteRecoveryCode(recoveryCode) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await callRecovery("use", { code: recoveryCode });
      if (!answer.ok) {
        setError(recoveryErrorText(answer.error));
        return;
      }
      toast.success("Two-step sign-in is off", { description: "Turn it on again in Account settings and save new recovery codes." });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteCode(code) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
      const factor = verifiedTotp(list?.totp as never)[0];
      if (listError || !factor) {
        setError("Could not find your authenticator app. Sign out and try again.");
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: cleanCode(code) });
      if (verifyError) {
        setError(mfaErrorText(verifyError.message));
        setCode("");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  if (recovering) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#020617" }}>
        <form onSubmit={submitRecovery} className="w-full max-w-sm p-6 rounded-2xl border border-white/10 bg-white/[0.02] text-white">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-[#00A3FF]" />
            <h1 className="text-lg font-semibold">Use a recovery code</h1>
          </div>
          <p className="text-sm text-zinc-500 mb-4">
            Type one of the recovery codes you saved when you turned on two-step sign-in. Each code works once. Using one turns two-step sign-in off until you set it up again.
          </p>
          <input
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={19}
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(cleanRecoveryInput(e.target.value))}
            placeholder="ABCD-EFGH-JKMN-PQRS"
            aria-label="Recovery code"
            className="w-full h-12 text-center text-lg tracking-widest font-mono bg-white/[0.03] border border-white/10 rounded-xl text-white placeholder:text-white/15 focus:outline-none focus:border-[#00A3FF]/40"
          />
          {error ? <p role="alert" className="text-sm text-red-400 mt-3">{error}</p> : null}
          <button
            type="submit"
            disabled={busy || !isCompleteRecoveryCode(recoveryCode)}
            className="w-full h-11 mt-4 rounded-xl text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "#00A3FF" }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Use code
          </button>
          <button type="button" onClick={() => { setRecovering(false); setError(null); }} className="w-full mt-3 text-xs text-zinc-500 hover:text-white transition-colors">
            Back to the 6-digit code
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#020617" }}>
      <form onSubmit={submit} className="w-full max-w-sm p-6 rounded-2xl border border-white/10 bg-white/[0.02] text-white">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-[#00A3FF]" />
          <h1 className="text-lg font-semibold">Confirm it's you</h1>
        </div>
        <p className="text-sm text-zinc-500 mb-4">Open your authenticator app and type the 6-digit code for NazAI.</p>
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(cleanCode(e.target.value))}
          placeholder="123456"
          aria-label="6-digit code"
          className="w-full h-12 text-center text-2xl tracking-[0.4em] font-mono bg-white/[0.03] border border-white/10 rounded-xl text-white placeholder:text-white/15 focus:outline-none focus:border-[#00A3FF]/40"
        />
        {error ? <p role="alert" className="text-sm text-red-400 mt-3">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || !isCompleteCode(code)}
          className="w-full h-11 mt-4 rounded-xl text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: "#00A3FF" }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Continue
        </button>
        <button type="button" onClick={() => { setRecovering(true); setError(null); }} className="w-full mt-3 text-xs text-zinc-400 hover:text-white transition-colors">
          Lost your phone? Use a recovery code
        </button>
        <button type="button" onClick={() => void signOut()} className="w-full mt-3 text-xs text-zinc-500 hover:text-white transition-colors">
          Sign out
        </button>
      </form>
    </div>
  );
};
