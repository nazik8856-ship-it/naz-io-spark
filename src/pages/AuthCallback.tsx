import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { resolveWelcomeEmailRecipient, sendWelcomeEmail } from "@/lib/send-welcome-email";

const AuthCallback = () => {
  const navigate = useNavigate();
  const { user, loading, refreshSession } = useAuth();
  const hasRedirectedRef = useRef(false);
  const hasProcessedRef = useRef(false);
  const hasSentWelcomeRef = useRef(false);

  // Handle OAuth hash fragment (direct Supabase OAuth returns tokens in URL hash)
  useEffect(() => {
    if (hasProcessedRef.current) return;
    hasProcessedRef.current = true;

    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(() => refreshSession())
        .catch((err) => console.error("Session set error:", err));
    } else {
      refreshSession().catch((err) => console.error("Auth callback error:", err));
    }
  }, [refreshSession]);

  useEffect(() => {
    if (loading || hasRedirectedRef.current) return;

    const finishAuth = async () => {
      hasRedirectedRef.current = true;

      if (user && !hasSentWelcomeRef.current) {
        hasSentWelcomeRef.current = true;
        const recipient = resolveWelcomeEmailRecipient({
          authData: { user },
          fallbackEmail: user.email,
          fallbackName: String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""),
          source: "auth-callback:oauth-session",
        });
        console.info("[auth-callback] authenticated session ready — forcing welcome email attempt", {
          userEmail: recipient.email,
          userId: recipient.userId,
        });
        await sendWelcomeEmail({
          email: recipient.email,
          name: recipient.name,
          userId: recipient.userId,
          source: "auth-callback:oauth-session",
        });
      }

      navigate(user ? "/dashboard" : "/signup", { replace: true });
    };

    finishAuth().catch((err) => {
      console.error("[auth-callback] welcome email flow failed", err);
      navigate(user ? "/dashboard" : "/signup", { replace: true });
    });
  }, [loading, user, navigate]);

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
