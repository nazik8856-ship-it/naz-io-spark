import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { resolveWelcomeEmailRecipient, sendWelcomeEmail } from "@/lib/send-welcome-email";

const getAuthErrorMessage = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes("email rate limit")) {
    return { title: "Too many attempts", description: "Please wait a few minutes, or continue with Google or Apple." };
  }
  if (normalized.includes("invalid login credentials")) {
    return {
      title: "Invalid credentials",
      description: "That email or password didn't match. Try again or use a social login.",
    };
  }
  if (normalized.includes("email not confirmed")) {
    return { title: "Email not confirmed", description: "Check your inbox, confirm your email, then sign in." };
  }
  return { title: "Authentication failed", description: message };
};

const AuthSkeleton = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: "#020617" }}>
    <div className="w-full max-w-md p-8 space-y-6">
      <div className="h-8 w-32 bg-white/5 rounded-lg animate-pulse" />
      <div className="h-5 w-64 bg-white/5 rounded animate-pulse" />
      <div className="space-y-4">
        <div className="h-12 bg-white/5 rounded-xl animate-pulse" />
        <div className="h-12 bg-white/5 rounded-xl animate-pulse" />
      </div>
      <div className="h-px bg-white/5" />
      <div className="space-y-3">
        <div className="h-10 bg-white/5 rounded-lg animate-pulse" />
        <div className="h-10 bg-white/5 rounded-lg animate-pulse" />
        <div className="h-10 bg-white/5 rounded-lg animate-pulse" />
      </div>
      <div className="h-12 bg-white/5 rounded-xl animate-pulse" />
    </div>
  </div>
);

const Signup = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, loading: authLoading, refreshSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", email: "", password: "" });
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (authLoading || !user || hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;
    navigate("/dashboard", { replace: true });
  }, [authLoading, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    hasRedirectedRef.current = false;

    try {
      console.info("[signup] attempting password sign-in first", { email: formData.email });
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (!signInError) {
        const recipient = resolveWelcomeEmailRecipient({
          authData: signInData,
          fallbackEmail: formData.email,
          fallbackName: formData.name,
          source: "signup-page:existing-user-signin",
        });
        console.info("[signup] sign-in succeeded — forcing welcome email attempt", {
          userEmail: recipient.email,
          userId: recipient.userId,
        });
        // Existing user signed in successfully — still send the welcome email
        // every time per product requirement (no first-time gating).
        await sendWelcomeEmail({
          email: recipient.email,
          name: recipient.name,
          userId: recipient.userId,
          source: "signup-page:existing-user-signin",
        });
        await refreshSession();
        return;
      }

      console.warn("[signup] sign-in failed, falling through to signUp", {
        message: signInError.message,
      });

      if (signInError.message.toLowerCase().includes("email rate limit")) {
        const friendlyError = getAuthErrorMessage(signInError.message);
        toast({ title: friendlyError.title, description: friendlyError.description, variant: "destructive" });
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
        console.warn("[signup] signUp returned error — still attempting welcome email", {
          message: signUpError.message,
        });
        // Even if signUp fails (e.g., user already exists), fire the welcome
        // email so repeated sign-up attempts always trigger delivery.
        await sendWelcomeEmail({
          email: formData.email,
          name: formData.name,
          source: "signup-page:signup-error-fallback",
        });
        const friendlyError = getAuthErrorMessage(signUpError.message);
        toast({ title: friendlyError.title, description: friendlyError.description, variant: "destructive" });
        return;
      }

      const recipient = resolveWelcomeEmailRecipient({
        authData: signUpData,
        fallbackEmail: formData.email,
        fallbackName: formData.name,
        source: "signup-page:new-signup",
      });

      console.info("[signup] signUp succeeded — forcing welcome email attempt", {
        userId: signUpData.user?.id,
        hasSession: !!signUpData.session,
        userEmail: recipient.email,
      });

      // Always send welcome email after a successful sign-up.
      await sendWelcomeEmail({
        email: recipient.email,
        name: recipient.name,
        userId: recipient.userId,
        source: "signup-page:new-signup",
      });

      if (signUpData.session) {
        await refreshSession();
        return;
      }

      toast({
        title: "Check your email",
        description: "Your account was created. Please confirm your email, then sign in.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSocialSignup = async (provider: "google" | "apple") => {
    setSocialLoading(provider);
    const isLovableDomain = window.location.hostname.endsWith(".lovable.app");

    try {
      if (isLovableDomain) {
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

  if (authLoading) return <AuthSkeleton />;

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "#020617", fontFamily: "'Inter', sans-serif" }}
    >
      {/* Subtle radial glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.06]"
          style={{ background: "radial-gradient(circle, #00A3FF 0%, transparent 70%)" }}
        />
      </div>

      <div className="w-full max-w-md mx-auto px-6 relative z-10">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-white/40 hover:text-white/70 transition-colors mb-8 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <div
          className="p-8 rounded-2xl border border-white/10 backdrop-blur-2xl"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          {/* Logo */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Naz<span style={{ color: "#00A3FF" }}>AI</span>
            </h2>
          </div>

          <h1 className="text-lg font-semibold text-white mb-1">Welcome back</h1>
          <p className="text-sm text-white/40 mb-8">Sign in to continue to your workspace.</p>

          {/* Social Login */}
          <div className="space-y-3 mb-6">
            <button
              type="button"
              onClick={() => handleSocialSignup("google")}
              disabled={!!socialLoading}
              className="w-full flex items-center justify-center gap-3 h-11 rounded-xl border border-white/10 bg-white/[0.03] text-white text-sm font-medium hover:bg-white/[0.06] transition-all disabled:opacity-40"
            >
              {socialLoading === "google" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
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
              )}
              Continue with Google
            </button>

            <button
              type="button"
              onClick={() => handleSocialSignup("apple")}
              disabled={!!socialLoading}
              className="w-full flex items-center justify-center gap-3 h-11 rounded-xl border border-white/10 bg-white/[0.03] text-white text-sm font-medium hover:bg-white/[0.06] transition-all disabled:opacity-40"
            >
              {socialLoading === "apple" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
              )}
              Continue with Apple
            </button>
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/5" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 text-white/25" style={{ background: "#020617" }}>
                or
              </span>
            </div>
          </div>

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs text-white/50 font-medium">
                Full Name
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="h-11 bg-white/[0.03] border-white/10 rounded-xl text-white placeholder:text-white/15 focus-visible:ring-[#00A3FF]/40 focus-visible:border-[#00A3FF]/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-white/50 font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="h-11 bg-white/[0.03] border-white/10 rounded-xl text-white placeholder:text-white/15 focus-visible:ring-[#00A3FF]/40 focus-visible:border-[#00A3FF]/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-white/50 font-medium">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                required
                minLength={6}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="h-11 bg-white/[0.03] border-white/10 rounded-xl text-white placeholder:text-white/15 focus-visible:ring-[#00A3FF]/40 focus-visible:border-[#00A3FF]/30"
              />
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

          <p className="text-center text-xs text-white/20 mt-6">
            Enter your credentials to sign in or create a new account.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Signup;
