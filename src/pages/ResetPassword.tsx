import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// Landed on from the "reset password" email link. Supabase redirects here with
// the recovery access_token/refresh_token in the URL hash (type=recovery) —
// this page exchanges those for a session, then lets the user pick a new
// password via updateUser, rather than treating the recovery link as a normal
// sign-in the way AuthCallback does for OAuth/signup confirmation links.
const ResetPassword = () => {
  const navigate = useNavigate();
  const hasProcessedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hasProcessedRef.current) return;
    hasProcessedRef.current = true;

    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const providerError = hashParams.get("error_description") || hashParams.get("error");
    if (providerError) {
      setTokenError(decodeURIComponent(providerError));
      setReady(true);
      return;
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (!accessToken || !refreshToken) {
      setTokenError("This reset link is missing or has already been used. Request a new one and try again.");
      setReady(true);
      return;
    }

    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) setTokenError(error.message);
      })
      .catch((err) => setTokenError(err instanceof Error ? err.message : String(err)))
      .finally(() => setReady(true));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password too short", { description: "Use at least 6 characters." });
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error("Couldn't update password", { description: error.message });
        return;
      }
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
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
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
