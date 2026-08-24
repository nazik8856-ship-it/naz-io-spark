// canva-oauth-callback — Canva redirects here with ?code and ?state.
// We atomically consume the server-side PKCE verifier keyed by state, exchange
// the code for tokens, and persist
// them in agent_integrations under provider="Canva". Uses the same
// Vault upsert pattern as gmail-oauth-callback.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { exchangeCode, fetchUserInfo } from "../_shared/canva.ts";
import { createSecret, updateSecret, readSecret } from "../_shared/integration-secrets.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

// Confirmed zero rate-limit coverage. This endpoint is public and
// unauthenticated (the OAuth provider redirects the browser here directly),
// so there's no real userId to key on until AFTER the one-time state token
// is consumed below -- this protects against repeated completions against
// the SAME account, not pre-auth guessing of the state param itself (that
// surface is the state token's own entropy + single-use consumption, not a
// rate limit).
const RATE_LIMIT_PER_MINUTE = 10;

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

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: transactionRows, error: transactionError } = await admin.rpc(
      "consume_canva_oauth_transaction",
      { _state: state },
    );
    const transaction = Array.isArray(transactionRows) ? transactionRows[0] : null;
    if (transactionError || !transaction) {
      return respond("Invalid state", "OAuth state is invalid, expired, or already used. Please try again.", false, 400);
    }

    const userId = transaction.user_id as string;
    const verifier = transaction.code_verifier as string;
    const groups = Array.isArray(transaction.scope_groups) ? transaction.scope_groups as string[] : [];
    if (!userId || !verifier) {
      return respond("Invalid state", "OAuth transaction data is incomplete. Please try again.", false, 400);
    }

    const rate = await checkRateLimit(admin, userId, "canva-oauth-callback", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return respond("Too many requests", "Too many connection attempts for this account. Try again shortly.", false, 429);
    }

    const tok = await exchangeCode(code, verifier);
    const info = await fetchUserInfo(tok.access_token);
    const now = new Date().toISOString();
    const credentials = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || null,
      expires_at: Date.now() + tok.expires_in * 1000,
      scope: tok.scope,
      email: info?.email || null,
      account_name: info?.display_name || info?.email || "Canva",
      account_email: info?.email || null,
      avatar: info?.avatar || null,
    };

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

    const integrationRow = {
      user_id: userId,
      agent_id: null,
      provider: "Canva",
      credentials_secret_id: secretId,
      metadata: {
        account_email: info?.email,
        account_name: info?.display_name || info?.email,
        avatar: info?.avatar,
        groups: mergedGroups,
      },
      status: "connected",
      last_verified_at: now,
      last_error: null,
      revoked_alerted_at: null,
    };
    const persistence = existing?.id
      ? admin.from("agent_integrations").update(integrationRow).eq("id", existing.id)
      : admin.from("agent_integrations").insert(integrationRow);
    const { error } = await persistence;
    if (error) throw new Error(error.message);
    return respond("Canva connected", `Connected as ${info?.display_name || info?.email || "Canva account"}. You can close this window.`, true, 200);
  } catch (e) {
    return respond("Canva connection failed", e instanceof Error ? e.message : "Unknown error", false, 500);
  }
});
