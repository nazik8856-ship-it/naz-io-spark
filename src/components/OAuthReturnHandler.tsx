import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Handles the return leg of an OAuth sign-in when the provider redirects
 * back to `window.location.origin` (which is what the Lovable-managed
 * Google/Apple OAuth client allowlists).
 *
 * Two responsibilities:
 *  1. Surface OAuth error params (`?error=...` or `#error=...`) as a toast
 *     instead of silently dropping the user back on the homepage.
 *  2. When the URL hash contains `access_token` (Supabase's detectSessionInUrl
 *     will consume it), wait for the SIGNED_IN event and route to /dashboard.
 */
const OAuthReturnHandler = () => {
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const hashParams = new URLSearchParams(hash);
    const queryParams = new URLSearchParams(window.location.search);

    const oauthError =
      hashParams.get("error_description") ||
      hashParams.get("error") ||
      queryParams.get("error_description") ||
      queryParams.get("error");

    if (oauthError) {
      console.error("[oauth-return] provider returned error:", oauthError);
      toast.error("Sign-in failed", { description: decodeURIComponent(oauthError) });
      // Strip the error from the URL so it doesn't retrigger on refresh.
      const url = new URL(window.location.href);
      url.hash = "";
      ["error", "error_description", "error_code"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, "", url.toString());
      return;
    }

    const hasOAuthTokens = hashParams.has("access_token");
    if (!hasOAuthTokens) return;

    // detectSessionInUrl (default true) will consume the hash and fire
    // onAuthStateChange with SIGNED_IN. Route to dashboard when that happens.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        navigate("/dashboard", { replace: true });
        data.subscription.unsubscribe();
      }
    });

    // Safety net: if the SDK already set the session before we subscribed,
    // getSession() will resolve with it and we still route through.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && window.location.hash.includes("access_token") === false) {
        navigate("/dashboard", { replace: true });
        data.subscription.unsubscribe();
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [navigate]);

  return null;
};

export default OAuthReturnHandler;
