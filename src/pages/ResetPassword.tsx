import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { sendPasswordChangedNotification } from "@/lib/send-auth-notification-email";
import { validatePassword, PASSWORD_REQUIREMENTS_HINT } from "@/lib/password-policy";

// Landed on from the "reset password" email link. Supabase's client already
// auto-processes the recovery link on its own (detectSessionInUrl defaults to
// true) as part of its async init — which starts at module load, before this
// component even mounts, and strips the tokens out of the URL hash once it's
// done. So parsing window.location.hash here directly is a race we can lose:
// by the time this effect runs, the hash may already be gone even though the
// SDK successfully established the recovery session. Instead we listen for
// the documented PASSWORD_RECOVERY event, and separately check getSession()
// right away in case that event already fired (and was missed) before this
// listener attached.
const ResetPassword = () => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let settled = false;
    const succeed = () => {
      if (settled) return;
      settled = true;
      setTokenError(null);
      setReady(true);
    };
    const fail = (message?: string) => {
      if (settled) return;
      settled = true;
      setTokenError(message || "This reset link is missing or has already been used. Request a new one and try again.");
      setReady(true);
    };

    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const providerError = hashParams.get("error_description") || hashParams.get("error");
    if (providerError) {
      fail(decodeURIComponent(providerError));
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") succeed();
    });

    // Covers the case where PASSWORD_RECOVERY already fired (and was missed)
    // before the listener above attached — _saveSession already persisted
    // the session by then, so getSession() reflects it either way.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) succeed();
    });

    // Neither path resolved in a reasonable window — the link genuinely had
    // no usable token (expired, already used, or opened with no hash at all).
    const timeout = setTimeout(() => fail(), 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const passwordError = validatePassword(password);
    if (passwordError) {
      toast.error("Password too weak", { description: passwordError });
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error("Couldn't update password", { description: error.message });
        return;
      }
      void sendPasswordChangedNotification(data.user?.email);
      toast.success("Password updated", { description: "You're signed in." });
      navigate("/dashboard", { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "rgba(2,6,23,1)", fontFamily: "'Inter', sans-serif" }}
    >
      <div className="w-full max-w-md p-8 rounded-2xl border border-white/10" style={{ background: "rgba(255,255,255,0.02)" }}>
        <h2 className="text-2xl font-bold text-white tracking-tight mb-1">
          Naz<span style={{ color: "#00A3FF" }}>AI</span>
        </h2>
        <h3 className="text-lg font-semibold text-white mb-1">Set a new password</h3>

        {!ready ? (
          <div className="flex items-center gap-2 text-white/40 text-sm mt-6">
            <Loader2 className="w-4 h-4 animate-spin" />
            Verifying your reset link…
          </div>
        ) : tokenError ? (
          <div className="mt-6">
            <p className="text-sm text-red-400 mb-4">{tokenError}</p>
            <button
              onClick={() => navigate("/")}
              className="w-full h-11 rounded-xl text-white text-sm font-semibold transition-all"
              style={{ background: "#00A3FF" }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="New password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 pr-11 bg-white/[0.03] border-white/10 rounded-xl text-white placeholder:text-white/15 focus-visible:ring-[#00A3FF]/40 focus-visible:border-[#00A3FF]/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 touch-manipulation text-cyan-500/50 hover:text-cyan-400 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
            <p className="text-xs text-white/30 -mt-2">{PASSWORD_REQUIREMENTS_HINT}</p>
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="Confirm new password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 bg-white/[0.03] border-white/10 rounded-xl text-white placeholder:text-white/15 focus-visible:ring-[#00A3FF]/40 focus-visible:border-[#00A3FF]/30"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "#00A3FF" }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {submitting ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
