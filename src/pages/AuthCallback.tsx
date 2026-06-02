import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { forceSendWelcomeEmailAfterAuth } from "@/lib/welcome-email-auth-debug";

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

    const hashParams = new URLSearchParams(window.location.hash.substring(1));
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
  }, [refreshSession]);

  useEffect(() => {
    if (processingCallback || loading || hasRedirectedRef.current) return;

    const finishAuth = async () => {
      hasRedirectedRef.current = true;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const authedUser = session?.user ?? user;

      if (authedUser) {
        await forceSendWelcomeEmailAfterAuth({
          data: { user: authedUser },
          fallbackEmail: authedUser.email || String(authedUser.user_metadata?.email ?? ""),
          fallbackName: String(authedUser.user_metadata?.full_name ?? authedUser.user_metadata?.name ?? ""),
          source: "auth-callback:oauth-session",
        });
        clearStaleDashboardCache();
      }

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
