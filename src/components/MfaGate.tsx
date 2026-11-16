// Two-step sign-in for the whole app (docs/two-step-sign-in.md). A signed-in person with an authenticator app is asked for its code
// before ANY page shows, not only the few pages under AuthGuard: the database already hides their account's data from a session that
// has not used the code (aal1), so without this a page like Control or API keys opened an empty-looking account and every server call
// was refused. Signed-out visitors and the pages a sign-in itself needs are left alone.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/with-timeout";
import { mfaStep } from "@/lib/mfa";
import { MfaChallenge } from "@/components/MfaChallenge";

/** Pages that must work while the code is still owed: finishing a sign-in, resetting a password, the legal pages, unsubscribing. */
export const MFA_EXEMPT_PATHS = ["/auth/callback", "/auth/reset-password", "/privacy", "/terms", "/unsubscribe"];
const CHECK_TIMEOUT_MS = 8_000;

export function MfaGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  // null: not known yet for this person. Re-checked when another person signs in.
  const [step, setStep] = useState<{ user: string; step: "ok" | "challenge" } | null>(null);

  const check = useCallback(async (userId: string) => {
    try {
      const { data, error } = await withTimeout(supabase.auth.mfa.getAuthenticatorAssuranceLevel(), CHECK_TIMEOUT_MS, "The sign-in check");
      // A check that fails does not lock the person out: the database still refuses their data and the server refuses their calls.
      setStep({ user: userId, step: error ? "ok" : mfaStep(data) });
    } catch {
      setStep({ user: userId, step: "ok" });
    }
  }, []);

  useEffect(() => {
    if (!loading && user) void check(user.id);
  }, [loading, user?.id, check]); // eslint-disable-line react-hooks/exhaustive-deps

  const exempt = MFA_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (loading || !user || exempt) return <>{children}</>;
  if (!step || step.user !== user.id) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#020617" }} data-testid="mfa-gate-checking">
        <div className="w-10 h-10 border-2 border-[#00A3FF]/30 border-t-[#00A3FF] rounded-full animate-spin" aria-label="Verifying session" />
      </div>
    );
  }
  if (step.step === "challenge") return <MfaChallenge onDone={() => void check(user.id)} />;
  return <>{children}</>;
}
