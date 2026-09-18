// Receives submissions from a generated website's forms (contact,
// newsletter, booking/quote). Public/unauthenticated -- the submitter is an
// anonymous site visitor, not a NazAI account holder -- so this is the one
// legitimate write path into website_form_submissions; the table itself has
// no anon/authenticated INSERT policy at all.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inlined from _shared/rate-limit.ts's checkIpRateLimit -- kept local so this
// single-shared-dep function can deploy as one file. Same fixed-window
// counter (increment_ip_rate_limit RPC), same fail-open-on-infra-error
// behavior as every other IP-keyed rate limit in this codebase.
async function checkIpRateLimit(
  admin: SupabaseClient,
  ip: string,
  endpoint: string,
  limitCount: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; count: number }> {
  try {
    const epochSec = Math.floor(Date.now() / 1000);
    const windowStart = new Date(Math.floor(epochSec / windowSeconds) * windowSeconds * 1000).toISOString();
    const { data, error } = await admin.rpc("increment_ip_rate_limit", {
      _ip: ip,
      _endpoint: endpoint,
      _window_start: windowStart,
    });
    if (error) return { allowed: true, count: 0 };
    const count = Number(data ?? 0);
    return { allowed: count <= limitCount, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALLOWED_KINDS = new Set(["contact", "newsletter", "booking", "quote", "custom"]);
const MAX_FIELDS = 20;
const MAX_FIELD_LEN = 4000;

const RATE_LIMIT_PER_WINDOW = 8;
const RATE_LIMIT_WINDOW_SECONDS = 600;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  const ipRate = await checkIpRateLimit(admin, ip, "website-form-submit", RATE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
  if (!ipRate.allowed) {
    return json({ error: "rate_limited", message: "Too many submissions — please try again later." }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const websiteId = String(body?.websiteId || "");
  const pageSlug = body?.pageSlug ? String(body.pageSlug).slice(0, 200) : null;
  const sectionKind = String(body?.sectionKind || "");
  const rawFields = body?.fields;

  if (!websiteId) return json({ error: "websiteId is required" }, 400);
  if (!ALLOWED_KINDS.has(sectionKind)) return json({ error: "invalid sectionKind" }, 400);
  if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) {
    return json({ error: "fields must be an object" }, 400);
  }
  const entries = Object.entries(rawFields as Record<string, unknown>).slice(0, MAX_FIELDS);
  if (!entries.length) return json({ error: "fields is empty" }, 400);
  const fields: Record<string, string> = {};
  for (const [k, v] of entries) {
    fields[String(k).slice(0, 200)] = String(v ?? "").slice(0, MAX_FIELD_LEN);
  }

  const { data: website, error: siteErr } = await admin
    .from("websites")
    .select("id, name, user_id")
    .eq("id", websiteId)
    .maybeSingle();
  if (siteErr || !website) return json({ error: "not_found" }, 404);

  const { error: insErr } = await admin.from("website_form_submissions").insert({
    website_id: websiteId,
    user_id: website.user_id,
    page_slug: pageSlug,
    section_kind: sectionKind,
    fields,
    submitter_ip: ip,
  });
  if (insErr) {
    console.error("website_form_submissions insert failed", insErr);
    return json({ error: "submit_failed" }, 500);
  }

  try {
    const { data: ownerUser } = await admin.auth.admin.getUserById(website.user_id as string);
    const ownerEmail = ownerUser?.user?.email;
    if (ownerEmail) {
      await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          templateName: "website-lead-notification",
          recipientEmail: ownerEmail,
          templateData: { siteName: website.name, sectionKind, pageSlug, fields },
        }),
      });
    }
  } catch (e) {
    // The submission is already saved -- a notification-email hiccup
    // shouldn't turn into a failure response to the site visitor.
    console.error("website lead notification failed", e);
  }

  return json({ ok: true });
});
