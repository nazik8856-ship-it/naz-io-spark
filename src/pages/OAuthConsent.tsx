import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

type AuthDetails = {
  redirect_url?: string;
  redirect_to?: string;
  client?: { name?: string; logo_uri?: string };
  scope?: string[] | string;
};

// Beta typed wrapper so TS accepts the `supabase.auth.oauth` namespace.
type OAuthNs = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthDetails | null; error: { message: string } | null }>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthNs }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve the FULL consent URL so auth returns the user here.
        const next = window.location.pathname + window.location.search;
        sessionStorage.setItem("nazai:post-auth-redirect", next);
        try {
          await lovable.auth.signInWithOAuth("google", {
            redirect_uri: window.location.origin + next,
          });
        } catch {
          window.location.href = "/login";
        }
        return;
      }
      const { data, error: err } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (err) return setError(err.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error: err } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (err) {
      setBusy(false);
      return setError(err.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("No redirect returned by the authorization server.");
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: "#020617" }}>
      <div
        className="w-full max-w-md rounded-2xl p-8 space-y-5"
        style={{
          background: "linear-gradient(135deg, rgba(0,163,255,0.06), rgba(0,163,255,0.02)), #08090c",
          border: "1px solid rgba(0,163,255,0.25)",
          boxShadow: "0 40px 120px -40px rgba(0,163,255,0.35)",
        }}
      >
        {error ? (
          <>
            <div className="text-[10px] uppercase tracking-[0.24em] font-mono text-red-300">Error</div>
            <h1 className="text-xl font-bold text-white">Could not load this authorization request</h1>
            <p className="text-sm text-zinc-400">{error}</p>
          </>
        ) : !details ? (
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <div className="w-4 h-4 border-2 border-[#00A3FF]/30 border-t-[#00A3FF] rounded-full animate-spin" />
            Loading authorization…
          </div>
        ) : (
          <>
            <div className="text-[10px] uppercase tracking-[0.24em] font-mono text-[#00A3FF]">
              Connect to NazAI
            </div>
            <h1 className="text-xl font-bold text-white">
              Connect {details.client?.name ?? "an app"} to your NazAI account?
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              This will let <span className="text-white">{details.client?.name ?? "the client"}</span>{" "}
              read your agents, projects, and runtime events, and trigger agent runs on your behalf via
              MCP. You can revoke access anytime.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                disabled={busy}
                onClick={() => decide(true)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #34d399, #22d3ee)" }}
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => decide(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
