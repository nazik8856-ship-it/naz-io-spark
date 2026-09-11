// figma-oauth-callback — Figma redirects here with ?code & ?state. We exchange
// the code for real access + refresh tokens, store them encrypted in Supabase
// Vault via agent_integrations.credentials_secret_id, then render a small
// page that notifies the opener window and closes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyState, exchangeCode, fetchUserInfo, FIGMA_SCOPES, FIGMA_DEFAULT_GROUPS, scopesForGroups } from "../_shared/figma.ts";
import { createSecret, updateSecret, readSecret } from "../_shared/integration-secrets.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { oauthCallbackPage } from "../_shared/oauth-callback-page.ts";

// Rate-limits repeated completions against the same account, keyed on the
// userId verifyState resolves once the signature checks out.
const RATE_LIMIT_PER_MINUTE = 10;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  // Set once verifyState succeeds below -- the origin captured at OAuth-start
  // time, used as the redirect-back target if this page has no
  // window.opener (see oauth-callback-page.ts's own doc comment for why).
  let redirectOrigin: string | null = null;
  const respond = (title: string, msg: string, ok: boolean, status = 200) =>
    new Response(
      oauthCallbackPage({ title, message: msg, ok, source: "nazai-figma-oauth", redirectOrigin }),
      { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  if (errParam) return respond("Figma connection cancelled", errParam, false, 400);
  if (!code || !state) return respond("Invalid callback", "Missing code or state.", false, 400);

  const parsed = await verifyState(state);
  if (!parsed) return respond("Invalid state", "OAuth state failed verification. Please try again.", false, 400);
  redirectOrigin = typeof parsed.o === "string" ? parsed.o : null;
  const userId = parsed.u as string;
  const agentId = (parsed.a as string | null) ?? null;
  const grantedGroups: string[] = Array.isArray(parsed.g) && (parsed.g as unknown[]).length
    ? (parsed.g as string[]).filter((g) => typeof g === "string")
    : FIGMA_DEFAULT_GROUPS;
  const grantedScopes = scopesForGroups(grantedGroups);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Single-use, mirroring Canva/Notion/Shopify/Slack's own DB-backed
  // transaction pattern -- verifyState's HMAC + expiry check alone let a
  // leaked/replayed state be redeemed more than once inside its window.
  const { data: txRows, error: txErr } = await admin.rpc("consume_figma_oauth_transaction", { _state: state });
  const tx = Array.isArray(txRows) ? txRows[0] : null;
  if (txErr || !tx) {
    return respond("Invalid state", "OAuth state is invalid, expired, or already used. Please try again.", false, 400);
  }

  const rate = await checkRateLimit(admin, userId, "figma-oauth-callback", RATE_LIMIT_PER_MINUTE, 60);
  if (!rate.allowed) {
    return respond("Too many requests", "Too many connection attempts for this account. Try again shortly.", false, 429);
  }

  try {
    const tok = await exchangeCode(code);
    const info = await fetchUserInfo(tok.access_token);
    const now = new Date().toISOString();
    const credentials: Record<string, unknown> = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || null,
      expires_at: Date.now() + tok.expires_in * 1000,
      scope: grantedScopes.join(" "),
      figma_user_id: info?.id || tok.user_id || null,
      handle: info?.handle || info?.email || "Figma",
      account_name: info?.handle || info?.email || "Figma",
      account_email: info?.email || null,
      avatar: info?.img_url || null,
    };

    const { data: existing } = await admin
      .from("agent_integrations")
      .select("id, credentials_secret_id")
      .eq("user_id", userId)
      .eq("provider", "Figma")
      .eq("agent_id", agentId)
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
      secretId = await createSecret(admin, credentials, `figma-${userId}-${agentId ?? "global"}`);
    }

    const { error } = await admin
      .from("agent_integrations")
      .upsert(
        {
          user_id: userId,
          agent_id: agentId,
          provider: "Figma",
          credentials_secret_id: secretId,
          
          metadata: {
            account_email: info?.email,
            account_name: info?.handle || info?.email,
            handle: info?.handle,
            avatar: info?.img_url,
            granted_scopes: grantedScopes,
            granted_groups: grantedGroups,
          },
          status: "connected",
          last_verified_at: now,
          last_error: null,
          revoked_alerted_at: null,
        },
        { onConflict: "user_id,provider,agent_id" },
      );
    if (error) throw new Error(error.message);
    return respond(
      "Figma connected",
      `Connected as ${info?.handle || info?.email || "Figma account"}.`,
      true,
    );
  } catch (e) {
    return respond("Figma connection failed", e instanceof Error ? e.message : "Unknown error", false, 500);
  }
});
