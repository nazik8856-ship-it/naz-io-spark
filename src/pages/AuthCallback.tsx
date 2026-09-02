import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { forceSendWelcomeEmailAfterAuth } from "@/lib/welcome-email-auth-debug";
import { sendSignInNotification } from "@/lib/send-auth-notification-email";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

// A user's very first sign-in sets last_sign_in_at equal to created_at.
// Landing here can mean completing a brand-new signup's email confirmation
// OR a brand-new OAuth signup (send the welcome email) — or a RETURNING
// user's OAuth/confirmed sign-in (send the sign-in security notice instead).
// A few seconds of tolerance covers normal request latency between the two
// timestamps being set.
const isFirstSignIn = (user: User): boolean => {
  const created = new Date(user.created_at).getTime();
  const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : created;
  return Math.abs(lastSignIn - created) < 10_000;
};

const clearStaleDashboardCache = () => {
  try {
    localStorage.removeItem("nazai-active-website-code");
    localStorage.removeItem("nazai-fitness-sample-seeded");
    sessionStorage.removeItem("nazai_directive");
  } catch {
    /* noop */
  }
};

const AuthCallback = () => {
  const navigate = useNavigate();
  const { user, loading, refreshSession } = useAuth();
  const hasRedirectedRef = useRef(false);
  const hasProcessedRef = useRef(false);
  const [processingCallback, setProcessingCallback] = useState(true);

  // Handle OAuth hash fragment (direct Supabase OAuth returns tokens in URL hash)
  useEffect(() => {
    if (hasProcessedRef.current) return;
    hasProcessedRef.current = true;

    // Surface provider-side OAuth errors instead of silently bouncing home.
    const queryParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const providerError =
      hashParams.get("error_description") ||
      hashParams.get("error") ||
      queryParams.get("error_description") ||
      queryParams.get("error");
    if (providerError) {
      const msg = decodeURIComponent(providerError);
      console.error("[auth-callback] provider error:", msg);
      toast.error("Sign-in failed", { description: msg });
      hasRedirectedRef.current = true;
      navigate("/", { replace: true });
      setProcessingCallback(false);
      return;
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(() => refreshSession())
        .catch((err) => console.error("Session set error:", err))
        .finally(() => setProcessingCallback(false));
    } else {
      refreshSession()
        .catch((err) => console.error("Auth callback error:", err))
        .finally(() => setProcessingCallback(false));
    }
  }, [refreshSession, navigate]);

  useEffect(() => {
    if (processingCallback || loading || hasRedirectedRef.current) return;

    const finishAuth = async () => {
      hasRedirectedRef.current = true;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const authedUser = session?.user ?? user;

      if (!authedUser) {
        // No error param AND no session — the OAuth exchange dropped tokens
        // somewhere (usually a redirect_uri mismatch). Don't silently redirect
        // to /dashboard where AuthGuard bounces the user home with zero signal.
        console.error("[auth-callback] no session after OAuth return");
        toast.error("Sign-in failed", {
          description:
            "The OAuth provider returned no session. This usually means the redirect URL isn't registered for this app. Try again or contact support.",
        });
        navigate("/", { replace: true });
        return;
      }

      if (isFirstSignIn(authedUser)) {
        await forceSendWelcomeEmailAfterAuth({
          data: { user: authedUser },
          fallbackEmail: authedUser.email || String(authedUser.user_metadata?.email ?? ""),
          fallbackName: String(authedUser.user_metadata?.full_name ?? authedUser.user_metadata?.name ?? ""),
          source: "auth-callback:oauth-session",
        });
      } else {
        const provider = authedUser.app_metadata?.provider;
        void sendSignInNotification(
          authedUser.email,
          provider === "google" || provider === "apple" ? provider : "password",
        );
      }
      clearStaleDashboardCache();
      navigate("/dashboard", { replace: true });
    };

    finishAuth().catch((err) => {
      console.error("[auth-callback] welcome email flow failed", err);
      clearStaleDashboardCache();
      navigate("/dashboard", { replace: true });
    });
  }, [processingCallback, loading, user, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="border-4 border-foreground/20 p-8 text-center space-y-3 max-w-sm">
        <div className="w-10 h-10 border-4 border-foreground border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="font-mono text-foreground text-lg font-bold">Signing you in…</p>
      </div>
    </div>
  );
};

export default AuthCallback;
