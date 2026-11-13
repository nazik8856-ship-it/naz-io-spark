import { withTimeout } from "@/lib/with-timeout";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { mfaStep } from "@/lib/mfa";
import { MfaChallenge } from "@/components/MfaChallenge";

const AuthSkeleton = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: "#020617" }}>
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#00A3FF]/30 border-t-[#00A3FF] rounded-full animate-spin" />
      <p className="text-sm text-white/30 font-medium">Verifying session…</p>
    </div>
  </div>
);

const MFA_CHECK_TIMEOUT_MS = 8_000;

export const AuthGuard = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  // null = not asked yet. A person with an authenticator app set up is asked for a code once per sign-in (aal1 -> aal2).
  const [step, setStep] = useState<"ok" | "challenge" | null>(null);

  const checkStep = useCallback(async () => {
    try {
      // The check waits on the browser's sign-in lock; a lock that never frees must not keep the page on its skeleton for ever.
      const { data, error } = await withTimeout(supabase.auth.mfa.getAuthenticatorAssuranceLevel(), MFA_CHECK_TIMEOUT_MS, "The sign-in check");
      // If the check itself fails the person is not locked out of the page: the database still refuses admin/owner data without aal2.
      setStep(error ? "ok" : mfaStep(data));
    } catch {
      setStep("ok");
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/", { replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!loading && user) void checkStep();
  }, [loading, user?.id, checkStep]);

  if (loading) return <AuthSkeleton />;
  if (!user) return null;
  if (step === null) return <AuthSkeleton />;
  if (step === "challenge") return <MfaChallenge onDone={() => void checkStep()} />;
  return <Outlet />;
};
