// shopify-oauth-callback — Shopify redirects here with ?code, ?shop, ?state,
// ?hmac, ?timestamp. We MUST verify the HMAC signature per Shopify security
// requirements before exchanging the code. Access tokens are stored per shop
// domain so users can connect multiple stores without overwriting each other.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSecret, updateSecret } from "../_shared/integration-secrets.ts";
import { exchangeCode, fetchShopInfo, normalizeShop, verifyCallbackHmac } from "../_shared/shopify.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { oauthCallbackPage } from "../_shared/oauth-callback-page.ts";

// Confirmed zero rate-limit coverage. Public/unauthenticated endpoint, so
// there's no real userId to key on until AFTER the one-time transaction is
// consumed below.
const RATE_LIMIT_PER_MINUTE = 10;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const shopParam = normalizeShop(url.searchParams.get("shop"));
  const errParam = url.searchParams.get("error");
  // Set once the transaction is consumed below -- the origin captured at
  // OAuth-start time, used as the redirect-back target if this page has no
  // window.opener (see oauth-callback-page.ts's own doc comment for why).
  let redirectOrigin: string | null = null;
  const respond = (title: string, msg: string, ok: boolean, shop?: string, status = 200) =>
    new Response(
      oauthCallbackPage({ title, message: msg, ok, source: "nazai-shopify-oauth", redirectOrigin, extra: { shop: shop || "" } }),
      { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  if (errParam) return respond("Shopify connection cancelled", errParam, false, shopParam || undefined, 400);
  if (!code || !state || !shopParam) {
    return respond("Invalid callback", "Missing code, state, or shop.", false, undefined, 400);
  }

  // MUST verify HMAC before doing anything else with the code.
  const hmacOk = await verifyCallbackHmac(url);
  if (!hmacOk) {
    return respond("Invalid callback", "Shopify HMAC signature failed verification. Request rejected.", false, undefined, 400);
  }

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows, error: txError } = await admin.rpc(
      "consume_shopify_oauth_transaction",
      { _state: state },
    );
    const tx = Array.isArray(rows) ? rows[0] : null;
    if (txError || !tx) {
      return respond("Invalid state", "OAuth state is invalid, expired, or already used. Please try again.", false, shopParam, 400);
    }
    redirectOrigin = typeof tx.request_origin === "string" ? tx.request_origin : null;
    const userId = tx.user_id as string;
    const expectedShop = normalizeShop(tx.shop_domain as string);
    if (!userId || !expectedShop || expectedShop !== shopParam) {
      return respond("Invalid callback", "Shop domain mismatch. Request rejected.", false, shopParam, 400);
    }

    const rate = await checkRateLimit(admin, userId, "shopify-oauth-callback", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return respond("Too many requests", "Too many connection attempts for this account. Try again shortly.", false, shopParam, 429);
    }

    const tok = await exchangeCode(shopParam, code);
    const info = await fetchShopInfo(shopParam, tok.access_token);
    const now = new Date().toISOString();

    const credentials = {
      access_token: tok.access_token,
      shop_domain: shopParam,
      scope: tok.scope,
      account_name: (info?.name as string) || shopParam,
      account_email: (info?.email as string) || null,
      shop_id: info?.id ?? null,
      shop_domain_pretty: (info?.domain as string) || shopParam,
    };

    // Upsert per shop: keyed on (user_id, provider="Shopify", metadata->>'shop').
    // Same user connecting multiple stores gets multiple rows, one per store.
    const { data: existing } = await admin
      .from("agent_integrations")
      .select("id, credentials_secret_id, metadata")
      .eq("user_id", userId)
      .eq("provider", "Shopify")
      .is("agent_id", null)
      .contains("metadata", { shop: shopParam })
      .maybeSingle();

    let secretId: string | null = (existing?.credentials_secret_id as string | null) ?? null;
    if (secretId) {
      await updateSecret(admin, secretId, credentials);
    } else {
      secretId = await createSecret(admin, credentials, `shopify-${userId}-${shopParam}`);
    }

    const integrationRow = {
      user_id: userId,
      agent_id: null,
      provider: "Shopify",
      credentials_secret_id: secretId,
      metadata: {
        shop: shopParam,
        shop_domain: shopParam,
        account_name: credentials.account_name,
        account_email: credentials.account_email,
        scope: tok.scope,
      },
      status: "connected",
      last_verified_at: now,
      last_error: null,
      revoked_alerted_at: null,
    };
    const persistence = existing?.id
      ? admin.from("agent_integrations").update(integrationRow).eq("id", existing.id)
      : admin.from("agent_integrations").insert(integrationRow);
    const { error: pErr } = await persistence;
    if (pErr) throw new Error(pErr.message);

    return respond(
      "Shopify connected",
      `Connected ${credentials.account_name} (${shopParam}).`,
      true,
      shopParam,
      200,
    );
  } catch (e) {
    return respond("Shopify connection failed", e instanceof Error ? e.message : "Unknown error", false, shopParam, 500);
  }
});
