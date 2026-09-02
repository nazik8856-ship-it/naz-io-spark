import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { validatePassword, PASSWORD_REQUIREMENTS_HINT } from "@/lib/password-policy";
import { sendPasswordChangedNotification } from "@/lib/send-auth-notification-email";
import { sanitizeAuthErrorMessage } from "@/lib/auth-error-message";

const PROVIDER_LABELS: Record<string, string> = { google: "Google", apple: "Apple", email: "Email & password" };

const AccountSettings = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [providers, setProviders] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getUserIdentities().then(({ data, error }) => {
      if (error) {
        console.error("[account-settings] getUserIdentities failed:", error.message);
        setProviders([]);
        return;
      }
      setProviders((data?.identities ?? []).map((i) => i.provider));
    });
  }, []);

  const hasPassword = providers?.includes("email") ?? false;

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
        toast.error("Couldn't update password", { description: sanitizeAuthErrorMessage(error.message) });
        return;
      }
      void sendPasswordChangedNotification(data.user?.email);
      toast.success(hasPassword ? "Password updated" : "Password set", {
        description: hasPassword
          ? "Your password has been changed."
          : "You can now also sign in with your email and this password.",
      });
      setPassword("");
      setConfirmPassword("");
      setProviders((prev) => (prev && !prev.includes("email") ? [...prev, "email"] : prev));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-2 px-6 py-5 border-b border-white/5">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>
      </header>

      <main className="px-4 sm:px-6 py-10 max-w-md mx-auto">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Account settings</h1>
        <p className="text-sm text-zinc-500 mb-8">{user?.email}</p>

        <div className="mb-8 p-4 rounded-xl border border-white/10 bg-white/[0.02]">
          <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-3">Signed in with</h2>
          {providers === null ? (
            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          ) : (
            <ul className="space-y-1">
              {providers.map((p) => (
                <li key={p} className="text-sm text-zinc-300">
                  {PROVIDER_LABELS[p] ?? p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02]">
          <h2 className="text-lg font-semibold mb-1">{hasPassword ? "Change password" : "Set a password"}</h2>
          <p className="text-sm text-zinc-500 mb-4">
            {hasPassword
              ? "Update the password you use to sign in with your email."
              : "Add a password so you can also sign in with your email, not just Google or Apple."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
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
            <p className="text-xs text-white/30">{PASSWORD_REQUIREMENTS_HINT}</p>
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
              {submitting ? "Saving…" : hasPassword ? "Update password" : "Set password"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default AccountSettings;
