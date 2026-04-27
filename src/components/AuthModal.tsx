import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { sendWelcomeEmail } from "@/lib/send-welcome-email";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const getAuthErrorMessage = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes("email rate limit"))
    return { title: "Too many attempts", description: "Please wait a few minutes, or continue with Google or Apple." };
  if (normalized.includes("invalid login credentials"))
    return { title: "Invalid credentials", description: "That email or password didn't match." };
  if (normalized.includes("email not confirmed"))
    return { title: "Email not confirmed", description: "Check your inbox and confirm your email first." };
  return { title: "Authentication failed", description: message };
};

const AuthModal: React.FC<AuthModalProps> = ({ open, onClose, onSuccess }) => {
  const { toast } = useToast();
  const { refreshSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", password: "" });

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (!signInError) {
        await refreshSession();
        onSuccess();
        return;
      }

      if (signInError.message.toLowerCase().includes("email rate limit")) {
        const err = getAuthErrorMessage(signInError.message);
        toast({ title: err.title, description: err.description, variant: "destructive" });
        return;
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: { full_name: formData.name },
          emailRedirectTo: `${window.location.origin}/generating`,
        },
      });

      if (signUpError) {
        const err = getAuthErrorMessage(signUpError.message);
        toast({ title: err.title, description: err.description, variant: "destructive" });
        return;
      }

      // Fire-and-forget welcome email — unique idempotency key per attempt so
      // repeated sign-ups always trigger a fresh welcome email.
      try {
        void supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "welcome-nazai",
            recipientEmail: formData.email,
            idempotencyKey: `welcome-${signUpData.user?.id ?? formData.email}-${Date.now()}-${crypto.randomUUID()}`,
            templateData: { name: formData.name },
          },
        });
      } catch {
        /* non-blocking */
      }

      if (signUpData.session) {
        await refreshSession();
        onSuccess();
        return;
      }

      toast({ title: "Check your email", description: "Confirm your email, then sign in." });
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = async (provider: "google" | "apple") => {
    setSocialLoading(provider);
    const isLovable = window.location.hostname.endsWith(".lovable.app");

    try {
      if (isLovable) {
        const { error } = await lovable.auth.signInWithOAuth(provider, {
          redirect_uri: window.location.origin + "/auth/callback",
        });
        if (error) {
          toast({ title: "Sign in failed", description: String(error), variant: "destructive" });
          setSocialLoading(null);
        }
      } else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${window.location.origin}/generating` },
        });
        if (error) {
          toast({ title: "Sign in failed", description: error.message, variant: "destructive" });
          setSocialLoading(null);
        }
      }
    } catch (err) {
      toast({ title: "Sign in failed", description: String(err), variant: "destructive" });
      setSocialLoading(null);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="auth-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)" }}
      >
        {/* Overlay click-to-close */}
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 w-full max-w-md mx-4 p-8 rounded-2xl border border-white/10"
          style={{ background: "rgba(255,255,255,0.02)", fontFamily: "'Inter', sans-serif" }}
        >
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
          >
            <X size={16} />
          </button>

          {/* Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Naz<span style={{ color: "#00A3FF" }}>AI</span>
            </h2>
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">Authenticate to continue</h3>
          <p className="text-sm text-white/40 mb-8">Sign in to initialize your mission.</p>

          {/* Social */}
          <div className="space-y-3 mb-6">
            <button
              type="button"
              onClick={() => handleSocial("google")}
              disabled={!!socialLoading}
              className="w-full flex items-center justify-center gap-3 h-11 rounded-xl border border-white/10 bg-white/[0.03] text-white text-sm font-medium hover:bg-white/[0.06] transition-all disabled:opacity-40"
            >
              {socialLoading === "google" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-white/50">Connecting to Node…</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSocial("apple")}
              disabled={!!socialLoading}
              className="w-full flex items-center justify-center gap-3 h-11 rounded-xl border border-white/10 bg-white/[0.03] text-white text-sm font-medium hover:bg-white/[0.06] transition-all disabled:opacity-40"
            >
              {socialLoading === "apple" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-white/50">Connecting to Node…</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                  </svg>
                  Continue with Apple
                </>
              )}
            </button>
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/5" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 text-white/25" style={{ background: "rgba(2,6,23,1)" }}>
                or
              </span>
            </div>
          </div>

          {/* Email Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <Input
              type="text"
              placeholder="Full Name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="h-11 bg-white/[0.03] border-white/10 rounded-xl text-white placeholder:text-white/15 focus-visible:ring-[#00A3FF]/40 focus-visible:border-[#00A3FF]/30"
            />
            <Input
              type="email"
              placeholder="you@example.com"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="h-11 bg-white/[0.03] border-white/10 rounded-xl text-white placeholder:text-white/15 focus-visible:ring-[#00A3FF]/40 focus-visible:border-[#00A3FF]/30"
            />
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                required
                minLength={6}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
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
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "#00A3FF" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Signing in…" : "Continue"}
            </button>
          </form>

          <p className="text-center text-xs text-white/15 mt-6">Sign in or create a new account to continue.</p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AuthModal;
