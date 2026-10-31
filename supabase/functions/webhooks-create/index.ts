// Server-side creation for outbound webhooks. Previously ControlWebhooks.tsx
// generated the signing secret in the browser and inserted the row directly
// via the client SDK -- and its listing query re-selected the plaintext
// `secret` column on every page load, not just once at creation, so the
// live HMAC signing secret was readable indefinitely by anyone with page/
// network access to the account, not just at the moment it was created.
//
// Matches api-keys/index.ts's own established pattern exactly: the secret
// is generated here, inserted via the service-role client, and returned to
// the caller EXACTLY ONCE in this response. The `webhooks` table's `secret`
// column has SELECT revoked from anon/authenticated (see the migration),
// so a normal client SELECT can never read it back again -- only this
// function (service role) and the background delivery sweeps that sign
// outbound payloads with it can still see it.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateOutboundUrl } from "../_shared/url-safety.ts";
import { resolveAccountScope } from "../_shared/account-scope.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { storeSigningSecret } from "../_shared/signing-secrets.ts";
import { deleteSecret } from "../_shared/integration-secrets.ts";
import { requireCaller } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CREATE_RATE_LIMIT_PER_MINUTE = 10;

function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authed = await requireCaller(req, (h) => createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: h } } }));
  if (!authed.ok) return json({ error: "unauthorized" }, 401);
  const userClient = authed.caller.userClient;
  const userId = authed.caller.userId;

  const admin = createClient(supabaseUrl, serviceKey);

  const body = await req.json().catch(() => ({}));
  const targetUserId = await resolveAccountScope(userClient, userId, body?.account_id, "integrations");
  if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

  const rate = await checkRateLimit(admin, userId, "webhooks-create", CREATE_RATE_LIMIT_PER_MINUTE, 60);
  if (!rate.allowed) {
    return json({
      error: "rate_limited",
      message: `Too many webhook-creation attempts — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
    }, 429);
  }

  const url = String(body?.url || "");
  if (!/^https:\/\//.test(url)) return json({ error: "Needs an https:// URL" }, 400);
  // The same check every delivery makes (https, a public address), up front instead of failing at the first event.
  const urlCheck = await validateOutboundUrl(url);
  if (!urlCheck.ok) return json({ error: `That URL can't receive webhooks: ${urlCheck.reason}` }, 400);
  const events = Array.isArray(body?.events) ? body.events.filter((e: unknown) => typeof e === "string") : [];
  if (!events.length) return json({ error: "Pick at least one event" }, 400);

  // The signing secret is stored in Vault (the row keeps only its id) and returned exactly once, in this response.
  const secret = generateSecret();
  const secretId = await storeSigningSecret(admin, secret, `webhook-${targetUserId}`).catch(() => null);
  if (!secretId) return json({ error: "Couldn't store the signing secret, so no webhook was created" }, 500);
  const { data, error } = await admin
    .from("webhooks")
    .insert({ user_id: targetUserId, url, secret: "", secret_id: secretId, events, enabled: true })
    .select("id, url, events, enabled, created_at")
    .maybeSingle();
  if (error || !data) {
    await deleteSecret(admin, secretId);
    return json({ error: error ? error.message : "Couldn't create the webhook" }, 500);
  }

  return json({ ok: true, secret, ...data });
});
