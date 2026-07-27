// canva-oauth-callback — Canva redirects here with ?code & ?state. We exchange
// the code for tokens, upsert an agent_integrations row under provider "Canva"
// with credentials encrypted in Supabase Vault (secret name "canva-<user>-global"),
// then render a small page that notifies the opener window and closes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyState, exchangeCode, fetchUserInfo, scopesForGroups } from "../_shared/canva.ts";
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
    window.opener.postMessage({ source:"nazai-canva-oauth", ok:${ok}, message:${JSON.stringify(msg)} }, "*");
  }
} catch(e){}
setTimeout(function(){ window.close(); }, 120);
</script></body></html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  const respond = (title: string, msg: string, ok: boolean, status = 200) =>
    new Response(html(title, msg, ok), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (errParam) return respond("Canva connection cancelled", errParam, false, 400);
  if (!code || !state) return respond("Invalid callback", "Missing code or state.", false, 400);

  const parsed = await verifyState(state);
  if (!parsed) return respond("Invalid state", "OAuth state failed verification. Please try again.", false, 400);
  const userId = parsed.u as string;
  const agentId: string | null = null;
  const groups = Array.isArray(parsed.g) ? (parsed.g as string[]) : [];

  try {
    const tok = await exchangeCode(code);
    const info = await fetchUserInfo(tok.access_token);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date().toISOString();
    const grantedScopes = scopesForGroups(groups);
    const credentials: Record<string, unknown> = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || null,
      expires_at: Date.now() + (tok.expires_in || 0) * 1000,
      scope: tok.scope || grantedScopes.join(" "),
      canva_user_id: info?.id || null,
      handle: info?.display_name || info?.email || "Canva",
      account_name: info?.display_name || info?.email || "Canva",
      account_email: info?.email || null,
    };

    // Reuse the existing Vault secret id (upsert pattern, avoids
    // secrets_name_idx collisions), preserving refresh_token if Canva
    // omitted one on this exchange.
    const { data: existing } = await admin
      .from("agent_integrations")
      .select("id, credentials_secret_id, metadata")
      .eq("user_id", userId)
      .eq("provider", "Canva")
      .is("agent_id", null)
      .maybeSingle();

    if (!tok.refresh_token && existing?.credentials_secret_id) {
      const prev = await readSecret(admin, existing.credentials_secret_id as string);
      const prevRt = (prev as { refresh_token?: string })?.refresh_token;
      if (prevRt) credentials.refresh_token = prevRt;
    }

    let secretId: string | null = (existing?.credentials_secret_id as string | null) ?? null;
    if (secretId) {
      await updateSecret(admin, secretId, credentials);
    } else {
      secretId = await createSecret(admin, credentials, `canva-${userId}-global`);
    }

    const prevMeta = (existing?.metadata as Record<string, unknown> | null) || {};
    const prevGroups = Array.isArray(prevMeta.groups) ? (prevMeta.groups as string[]) : [];
    const mergedGroups = Array.from(new Set([...prevGroups, ...groups]));

    const { error } = await admin
      .from("agent_integrations")
      .upsert(
        {
          user_id: userId,
          agent_id: agentId,
          provider: "Canva",
          credentials_secret_id: secretId,
          metadata: {
            account_email: info?.email,
            account_name: info?.display_name || info?.email,
            groups: mergedGroups,
            granted_scopes: grantedScopes,
          },
          status: "connected",
          last_verified_at: now,
          last_error: null,
        },
        { onConflict: "user_id,provider,agent_id" },
      );
    if (error) throw new Error(error.message);
    return respond(
      "Canva connected",
      `Connected as ${info?.display_name || info?.email || "Canva account"}. You can close this window.`,
      true,
    );
  } catch (e) {
    return respond("Canva connection failed", e instanceof Error ? e.message : "Unknown error", false, 500);
  }
});
