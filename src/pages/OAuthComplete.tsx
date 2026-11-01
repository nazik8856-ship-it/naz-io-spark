import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { cancelledMessage, finishConnection, providerFrom } from "@/lib/oauth-complete";

// Where a connection to a tool ends: the provider's redirect lands here (via our callback), this page finishes it as the person signed
// in to THIS browser and tells the screen that opened the popup, exactly as the old result page did.
export default function OAuthComplete() {
  const [text, setText] = useState("Finishing your connection…");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const provider = providerFrom(search.get("provider"));
    // the code is single use and does not belong in history
    window.history.replaceState(null, "", window.location.pathname);
    if (!provider) { setBusy(false); setText("This link is not a connection link."); return; }

    const report = (message: Record<string, unknown>) => {
      setBusy(false);
      setText(String(message.message ?? ""));
      try { window.opener?.postMessage(message, window.location.origin); } catch { /* the opener is gone: the text above stays */ }
      if (window.opener) setTimeout(() => window.close(), 400);
      setTimeout(() => { if (!window.closed) window.location.replace("/"); }, 1800);
    };

    (async () => {
      const providerError = search.get("error");
      if (providerError) return report(cancelledMessage(provider, providerError));
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setBusy(false);
        setText("Sign in to NazAI in this window to finish connecting.");
        return;
      }
      report(await finishConnection({ provider, search, accessToken: token, baseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON }));
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-sm text-center space-y-3">
        {busy && <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />}
        <p className="text-sm text-muted-foreground" role="status">{text}</p>
      </div>
    </div>
  );
}
