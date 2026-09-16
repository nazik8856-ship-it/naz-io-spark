// Resend Webhook Endpoint
// Public POST endpoint that receives webhook events from Resend.
// Configure this URL in Resend → Webhooks, and copy the signing secret it
// shows you (starts with "whsec_") into this project's RESEND_WEBHOOK_SECRET
// edge function secret.
//
// Verifies the standard Svix signature scheme Resend signs webhooks with
// (svix-id/svix-timestamp/svix-signature) before trusting the body at all --
// previously this endpoint accepted the CORS-listed svix-* headers but never
// actually checked them, so anyone who found the URL could POST arbitrary
// forged events and have them processed as if Resend had sent them.
import { timingSafeEqual } from "../_shared/timing-safe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Tolerance window for the svix-timestamp header, matching Svix's own
// recommended practice -- bounds how old (or how far in the future) a
// "genuine" signed request can be, so a captured request/signature pair
// can't be replayed indefinitely.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function computeSvixSignature(secret: string, signedContent: string): Promise<string> {
  // Svix secrets are shipped as "whsec_<base64>" -- the prefix identifies the
  // secret format/version and is never part of the key material itself.
  const rawSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const keyBytes = base64ToBytes(rawSecret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  return bytesToBase64(new Uint8Array(sig));
}

/**
 * Verifies a Svix-signed webhook request. Returns null on success, or a
 * string reason on failure -- fail closed in every case (missing secret,
 * missing headers, stale timestamp, no matching signature).
 */
async function verifySvixSignature(
  secret: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  rawBody: string,
): Promise<string | null> {
  if (!svixId || !svixTimestamp || !svixSignature) return "missing svix headers";

  const tsNum = Number(svixTimestamp);
  if (!Number.isFinite(tsNum)) return "invalid svix-timestamp";
  const nowSeconds = Date.now() / 1000;
  if (Math.abs(nowSeconds - tsNum) > TIMESTAMP_TOLERANCE_SECONDS) return "stale svix-timestamp";

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = await computeSvixSignature(secret, signedContent);

  // svix-signature can carry multiple space-separated "v1,<base64>" values
  // (e.g. during secret rotation) -- a match against any one is valid.
  const candidates = svixSignature.split(" ").map((part) => part.split(",")[1]).filter(Boolean);
  for (const candidate of candidates) {
    if (timingSafeEqual(candidate, expected)) return null;
  }
  return "signature mismatch";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) {
    console.error("RESEND_WEBHOOK_SECRET is not configured -- rejecting all webhook traffic (fail closed)");
    return json({ error: "Server configuration error" }, 500);
  }

  const rawBody = await request.text();

  const failReason = await verifySvixSignature(
    secret,
    request.headers.get("svix-id"),
    request.headers.get("svix-timestamp"),
    request.headers.get("svix-signature"),
    rawBody,
  );
  if (failReason) {
    console.error(`Rejected resend webhook: ${failReason}`);
    return json({ error: "Invalid signature" }, 401);
  }

  try {
    const event = JSON.parse(rawBody);

    console.log("Received webhook event from Resend:", JSON.stringify(event));

    // Handle different event types
    if (event?.type === "email.received") {
      console.log("Email received event:", JSON.stringify(event));
      return json({ success: true, event });
    }

    // Log common Resend delivery events for visibility
    if (typeof event?.type === "string") {
      console.log(`Resend event type: ${event.type}`);
    }

    // Default response for other events
    return json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return json({ error: "Invalid webhook payload" }, 400);
  }
});
