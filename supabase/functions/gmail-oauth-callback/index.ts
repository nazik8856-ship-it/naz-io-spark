// gmail-oauth-callback — Google redirects here with ?code and ?state.
// We exchange the code for tokens and persist them in agent_integrations.
// Renders a small HTML page that notifies the opener window and closes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyState, exchangeCode, fetchUserInfo } from "../_shared/gmail.ts";
import { createSecret, updateSecret, readSecret } from "../_shared/integration-secrets.ts";

const html = (title: string, msg: string, ok: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;color:#e5e5e5;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
  .card{max-width:420px;background:#111;border:1px solid #222;border-radius:12px;padding:28px}
  h1{margin:0 0 8px;font-size:18px;color:${ok ? "#34d399" : "#f87171"}}
  p{margin:0;font-size:14px;line-height:1.5;color:#a3a3a3}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${msg}</p></div>
<script>
try {
  if (window.opener) {
    window.opener.postMessage({ source:"nazai-gmail-oauth", ok:${ok}, message:${JSON.stringify(msg)} }, "*");
  }
} catch(e){}
setTimeout(function(){ window.close(); }, 1200);
</script></body></html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  const respond = (title: string, msg: string, ok: boolean, status = 200) =>
    new Response(html(title, msg, ok), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (errParam) return respond("Gmail connection cancelled", errParam, false, 400);
  if (!code || !state) return respond("Invalid callback", "Missing code or state.", false, 400);

  const parsed = await verifyState(state);
  if (!parsed) return respond("Invalid state", "OAuth state failed verification. Please try again.", false, 400);
  const userId = parsed.u as string;
  const agentId = (parsed.a as string | null) ?? null;

  try {
    const tok = await exchangeCode(code);
    const info = await fetchUserInfo(tok.access_token);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date().toISOString();
    const credentials = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || null,
      expires_at: Date.now() + tok.expires_in * 1000,
      scope: tok.scope,
      email: info?.email || null,
      account_name: info?.name || info?.email || "Gmail",
      handle: info?.email || "Gmail",
      account_email: info?.email || null,
      avatar: info?.picture || null,
    };

    // Look up any existing row so we can (a) preserve a previous refresh_token
    // if Google didn't return one this time, and (b) reuse the existing Vault
    // secret id instead of orphaning it.
    const { data: existing } = await admin
      .from("agent_integrations")
      .select("id, credentials_secret_id")
      .eq("user_id", userId)
      .eq("provider", "Gmail")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (!tok.refresh_token && existing?.credentials_secret_id) {
      const prev = await readSecret(admin, existing.credentials_secret_id as string);
      const prevRt = (prev as { refresh_token?: string })?.refresh_token;
      if (prevRt) credentials.refresh_token = prevRt;
    }

    // Write credentials to Vault (create or update in place).
    let secretId: string | null = (existing?.credentials_secret_id as string | null) ?? null;
    if (secretId) {
      await updateSecret(admin, secretId, credentials);
    } else {
      secretId = await createSecret(admin, credentials, `gmail-${userId}-${agentId ?? "global"}`);
    }

    const { error } = await admin
      .from("agent_integrations")
      .upsert(
        {
          user_id: userId,
          agent_id: agentId,
          provider: "Gmail",
          credentials_secret_id: secretId,
          
          metadata: {
            account_email: info?.email,
            account_name: info?.name || info?.email,
            avatar: info?.picture,
          },
          status: "connected",
          last_verified_at: now,
          last_error: null,
        },
        { onConflict: "user_id,provider,agent_id" },
      );
    if (error) throw new Error(error.message);
    return respond("Gmail connected", `Connected as ${info?.email || "Gmail account"}. You can close this window.`, true);
  } catch (e) {
    return respond("Gmail connection failed", e instanceof Error ? e.message : "Unknown error", false, 500);
  }
});
