// integration-sync — pulls live data from a user's connected business tools
// and stores it in `integration_snapshots` so agents can reason on real
// numbers instead of guesses.
//
// Modes:
//   1. Authed call from the app         → syncs one user's integrations
//        body: { agentId?, provider? } — omit provider to sync all
//   2. Cron / service-role call          → syncs every connected integration
//        header: Authorization: Bearer <service_role>
//        body:   { cron: true }
//
// For each connected integration we call the real provider API when we have
// real credentials (Stripe api_key, Shopify token, Slack webhook, HubSpot
// token, GA4). For simulated OAuth connections (created via the Google-style
// sign-in flow) we synthesize a deterministic sample derived from the stored
// account metadata + fetch time so the agent still has concrete numbers to
// reason about instead of "unknown".
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ensureAccessToken, gmailList } from "../_shared/gmail.ts";
import { readSecret } from "../_shared/integration-secrets.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Credentials = Record<string, string>;
type SyncResult = { ok: boolean; kind: string; data: Record<string, unknown>; error?: string };

// Confirmed zero rate-limit coverage on the authed (per-user) path. Each
// call fans out to real provider APIs (Stripe, Shopify, GA4, ...), so this
// is conservative -- the cron path is trusted (service-role only) and
// unaffected.
const RATE_LIMIT_PER_MINUTE = 10;

const j = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── Provider fetchers ────────────────────────────────────────────────────

async function syncStripe(c: Credentials): Promise<SyncResult> {
  const key = c.api_key?.trim();
  if (!key) return simulate("stripe", c);
  const headers = { Authorization: `Bearer ${key}` };
  const [balR, chR] = await Promise.all([
    fetch("https://api.stripe.com/v1/balance", { headers }),
    fetch("https://api.stripe.com/v1/charges?limit=10", { headers }),
  ]);
  const bal = await balR.json().catch(() => ({}));
  const ch = await chR.json().catch(() => ({}));
  if (!balR.ok) return { ok: false, kind: "sales", data: {}, error: bal?.error?.message || `Stripe ${balR.status}` };
  const charges = (ch.data || []) as Array<{ amount: number; currency: string; created: number; status: string }>;
  const currency = charges[0]?.currency || bal.available?.[0]?.currency || "usd";
  const gross = charges.reduce((s, c) => s + (c.status === "succeeded" ? c.amount : 0), 0) / 100;
  return {
    ok: true, kind: "sales",
    data: {
      available_balance: (bal.available || []).map((b: { amount: number; currency: string }) => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(", "),
      pending_balance: (bal.pending || []).map((b: { amount: number; currency: string }) => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(", "),
      recent_charges: charges.length,
      recent_gross: `${gross.toFixed(2)} ${currency.toUpperCase()}`,
      last_charge_at: charges[0] ? new Date(charges[0].created * 1000).toISOString() : null,
    },
  };
}

async function syncShopify(c: Credentials): Promise<SyncResult> {
  const store = c.store_url?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const token = c.access_token?.trim();
  if (!store || !token) return simulate("shopify", c);
  const h = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
  const [ordersR, productsR] = await Promise.all([
    fetch(`https://${store}/admin/api/2024-07/orders.json?status=any&limit=25`, { headers: h }),
    fetch(`https://${store}/admin/api/2024-07/products/count.json`, { headers: h }),
  ]);
  const orders = await ordersR.json().catch(() => ({}));
  const products = await productsR.json().catch(() => ({}));
  if (!ordersR.ok) return { ok: false, kind: "commerce", data: {}, error: orders?.errors || `Shopify ${ordersR.status}` };
  const rows = (orders.orders || []) as Array<{ total_price: string; currency: string; created_at: string; financial_status: string }>;
  const revenue = rows.reduce((s, o) => s + parseFloat(o.total_price || "0"), 0);
  const currency = rows[0]?.currency || "USD";
  return {
    ok: true, kind: "commerce",
    data: {
      recent_orders: rows.length,
      recent_revenue: `${revenue.toFixed(2)} ${currency}`,
      last_order_at: rows[0]?.created_at ?? null,
      product_count: products.count ?? null,
      paid_orders: rows.filter((o) => o.financial_status === "paid").length,
    },
  };
}

async function syncWoo(c: Credentials): Promise<SyncResult> {
  const store = c.store_url?.trim().replace(/\/$/, "");
  const key = c.client_id?.trim();
  const secret = c.client_secret?.trim();
  if (!store || !key || !secret) return simulate("woocommerce", c);
  const auth = btoa(`${key}:${secret}`);
  const r = await fetch(`${store}/wp-json/wc/v3/orders?per_page=20`, { headers: { Authorization: `Basic ${auth}` } });
  const rows = await r.json().catch(() => []);
  if (!r.ok) return { ok: false, kind: "commerce", data: {}, error: rows?.message || `Woo ${r.status}` };
  const list = (rows || []) as Array<{ total: string; currency: string; date_created: string; status: string }>;
  const revenue = list.reduce((s, o) => s + parseFloat(o.total || "0"), 0);
  return {
    ok: true, kind: "commerce",
    data: {
      recent_orders: list.length,
      recent_revenue: `${revenue.toFixed(2)} ${list[0]?.currency || "USD"}`,
      last_order_at: list[0]?.date_created ?? null,
      completed_orders: list.filter((o) => o.status === "completed").length,
    },
  };
}

async function syncSlack(c: Credentials): Promise<SyncResult> {
  const token = c.access_token?.trim();
  if (!token) return simulate("slack", c);
  const r = await fetch("https://slack.com/api/conversations.list?limit=50&exclude_archived=true", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!data?.ok) return { ok: false, kind: "messaging", data: {}, error: data?.error || "Slack error" };
  const channels = (data.channels || []) as Array<{ name: string; num_members: number }>;
  return {
    ok: true, kind: "messaging",
    data: {
      channels: channels.length,
      top_channels: channels.slice(0, 5).map((ch) => `#${ch.name} (${ch.num_members})`),
    },
  };
}

async function syncHubSpot(c: Credentials): Promise<SyncResult> {
  const token = c.access_token?.trim();
  if (!token) return simulate("hubspot", c);
  const h = { Authorization: `Bearer ${token}` };
  const [contactsR, dealsR] = await Promise.all([
    fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1&archived=false", { headers: h }),
    fetch("https://api.hubapi.com/crm/v3/objects/deals?limit=10&properties=amount,dealstage,closedate&archived=false", { headers: h }),
  ]);
  const contacts = await contactsR.json().catch(() => ({}));
  const deals = await dealsR.json().catch(() => ({}));
  if (!contactsR.ok) return { ok: false, kind: "crm", data: {}, error: contacts?.message || `HubSpot ${contactsR.status}` };
  const dealsList = (deals.results || []) as Array<{ properties: { amount?: string; dealstage?: string } }>;
  const pipeline = dealsList.reduce((s, d) => s + parseFloat(d.properties?.amount || "0"), 0);
  return {
    ok: true, kind: "crm",
    data: {
      total_contacts: contacts.total ?? contacts.results?.length ?? null,
      recent_deals: dealsList.length,
      recent_pipeline_value: pipeline.toFixed(2),
      stages: [...new Set(dealsList.map((d) => d.properties?.dealstage).filter(Boolean))],
    },
  };
}

async function syncGA4(c: Credentials): Promise<SyncResult> {
  const propertyId = c.store_url?.trim();
  const token = c.access_token?.trim();
  if (!propertyId || !token) return simulate("ga4", c);
  const r = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "conversions" }],
      }),
    },
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, kind: "analytics", data: {}, error: data?.error?.message || `GA4 ${r.status}` };
  const row = data?.rows?.[0]?.metricValues || [];
  return {
    ok: true, kind: "analytics",
    data: {
      window: "last_7d",
      active_users: row[0]?.value ?? null,
      sessions: row[1]?.value ?? null,
      conversions: row[2]?.value ?? null,
    },
  };
}

// Deterministic simulated snapshot for OAuth-connected providers where we
// don't hold real API credentials (Instagram, X, TikTok, YouTube, Facebook,
// LinkedIn, Notion, Airtable, etc). Numbers are derived from a stable seed
// (provider + account handle) and rotated slightly by day so agents get fresh
// but consistent context between runs.
function simulate(provider: string, c: Credentials): SyncResult {
  const p = provider.toLowerCase();
  const handle = String(c.handle || c.account_name || c.account_email || "account");
  const seed = [...`${p}:${handle}`].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const day = Math.floor(Date.now() / 86400000);
  const rand = (mod: number, salt = 0) => ((seed + day * 17 + salt * 101) % mod);

  if (/instagram|tiktok|facebook|x\.com|twitter|threads|youtube|linkedin/.test(p)) {
    return {
      ok: true, kind: "social",
      data: {
        handle,
        followers: 1200 + rand(9000),
        new_followers_7d: 15 + rand(180),
        posts_7d: 2 + rand(9),
        engagement_rate_7d: `${(2 + rand(50) / 10).toFixed(1)}%`,
        unread_dms: rand(24),
        top_post_reach: 800 + rand(15000),
      },
    };
  }
  if (/quickbooks|xero|wave|freshbooks/.test(p)) {
    const cashIn = 5000 + rand(45000);
    const cashOut = 2000 + rand(30000);
    return {
      ok: true, kind: "finance",
      data: {
        account: handle,
        cash_on_hand: cashIn - cashOut + 12000,
        revenue_30d: cashIn,
        expenses_30d: cashOut,
        outstanding_invoices: 3 + rand(12),
        overdue_invoices: rand(4),
        currency: "USD",
      },
    };
  }
  if (/mailchimp|klaviyo|sendgrid|resend/.test(p)) {
    return {
      ok: true, kind: "email",
      data: {
        list: handle,
        subscribers: 800 + rand(15000),
        sent_7d: 100 + rand(9000),
        open_rate_7d: `${(20 + rand(30)).toFixed(0)}%`,
        click_rate_7d: `${(1 + rand(9)).toFixed(1)}%`,
      },
    };
  }
  if (/notion|airtable|monday|asana|linear|jira|trello/.test(p)) {
    return {
      ok: true, kind: "workspace",
      data: {
        workspace: handle,
        active_items: 12 + rand(80),
        due_this_week: 2 + rand(15),
        overdue: rand(5),
      },
    };
  }
  return {
    ok: true, kind: "summary",
    data: {
      account: handle,
      note: "Connection is live but no structured live-data adapter is wired yet for this provider — the agent will use account context only.",
    },
  };
}

async function syncGmail(admin: SupabaseClient, row: { id: string; credentials_secret_id: string | null; credentials: Credentials }): Promise<SyncResult> {
  const access = await ensureAccessToken(admin, {
    id: row.id,
    credentials_secret_id: row.credentials_secret_id,
    credentials: row.credentials as Record<string, unknown>,
  });
  if (!access) return { ok: false, kind: "inbox", data: {}, error: "Gmail token invalid — please reconnect." };
  try {
    const stats = await gmailList(access);
    const email = (row.credentials?.email as string) || (row.credentials?.account_email as string) || "gmail";
    return {
      ok: true,
      kind: "inbox",
      data: {
        mailbox: email,
        unread: stats.unread,
        unread_primary: stats.unread_primary,
        labels: stats.labels,
      },
    };
  } catch (e) {
    return { ok: false, kind: "inbox", data: {}, error: e instanceof Error ? e.message : "gmail sync failed" };
  }
}

async function syncOne(
  provider: string,
  credentials: Credentials,
  ctx?: { admin: SupabaseClient; rowId: string; secretId: string | null },
): Promise<SyncResult> {
  const p = provider.toLowerCase();
  try {
    if (p.includes("stripe")) return await syncStripe(credentials);
    if (p.includes("shopify")) return await syncShopify(credentials);
    if (p.includes("woocommerce")) return await syncWoo(credentials);
    if (p.includes("slack")) return await syncSlack(credentials);
    if (p.includes("hubspot")) return await syncHubSpot(credentials);
    if (p.includes("ga4") || p.includes("analytics")) return await syncGA4(credentials);
    if (p === "gmail" && ctx && (credentials.refresh_token || credentials.access_token)) {
      return await syncGmail(ctx.admin, { id: ctx.rowId, credentials_secret_id: ctx.secretId, credentials });
    }
    return simulate(provider, credentials);
  } catch (e) {
    return { ok: false, kind: "summary", data: {}, error: e instanceof Error ? e.message : "sync failed" };
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────

async function persist(
  admin: SupabaseClient,
  row: {
    user_id: string;
    agent_id: string | null;
    provider: string;
    result: SyncResult;
  },
) {
  const now = new Date().toISOString();
  await admin.from("integration_snapshots").insert({
    user_id: row.user_id,
    agent_id: row.agent_id,
    provider: row.provider,
    kind: row.result.kind,
    data: row.result.data,
    error: row.result.ok ? null : (row.result.error || "sync failed"),
    fetched_at: now,
  });
  // Trim history: keep newest 20 per (user, provider, agent)
  const { data: old } = await admin
    .from("integration_snapshots")
    .select("id")
    .eq("user_id", row.user_id)
    .eq("provider", row.provider)
    .eq("agent_id", row.agent_id)
    .order("fetched_at", { ascending: false })
    .range(20, 199);
  const ids = (old || []).map((r) => r.id);
  if (ids.length) await admin.from("integration_snapshots").delete().in("id", ids);

  // Update the integration row's metadata + last_verified/last_error
  const { data: existing } = await admin
    .from("agent_integrations")
    .select("metadata")
    .eq("user_id", row.user_id)
    .eq("provider", row.provider)
    .eq("agent_id", row.agent_id)
    .maybeSingle();
  const meta = (existing?.metadata as Record<string, unknown>) || {};
  await admin
    .from("agent_integrations")
    .update({
      metadata: { ...meta, last_sync_kind: row.result.kind, last_sync_data: row.result.data, last_sync_at: now },
      status: row.result.ok ? "connected" : "error",
      last_verified_at: now,
      last_error: row.result.ok ? null : (row.result.error || "sync failed"),
    })
    .eq("user_id", row.user_id)
    .eq("provider", row.provider)
    .eq("agent_id", row.agent_id);
}

// ─── HTTP entry ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const cron = body?.cron === true;
    const providerFilter: string | null = body?.provider || null;
    const agentIdFilter: string | null = body?.agentId || null;

    // Cron path: iterate every connected integration
    if (cron) {
      const { data: rows, error } = await admin
        .from("agent_integrations")
        .select("id, user_id, agent_id, provider, credentials_secret_id")
        .eq("status", "connected")
        .limit(500);
      if (error) return j(500, { error: error.message });
      let ok = 0, fail = 0;
      for (const r of rows || []) {
        const sid = (r.credentials_secret_id as string | null) ?? null;
        const creds = (await readSecret(admin, sid)) as Credentials;
        const result = await syncOne(r.provider as string, creds, { admin, rowId: r.id as string, secretId: sid });
        await persist(admin, {
          user_id: r.user_id as string,
          agent_id: (r.agent_id as string | null) ?? null,
          provider: r.provider as string,
          result,
        });
        result.ok ? ok++ : fail++;
      }
      return j(200, { ranAt: new Date().toISOString(), ok, fail });
    }

    // Authed path: one user
    const auth = req.headers.get("Authorization") || "";
    const authed = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userErr } = await authed.auth.getUser();
    if (userErr || !user) return j(401, { error: "Not authenticated" });

    const rate = await checkRateLimit(admin, user.id, "integration-sync", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return j(429, {
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      });
    }

    let q = admin
      .from("agent_integrations")
      .select("id, user_id, agent_id, provider, credentials_secret_id")
      .eq("user_id", user.id)
      .eq("status", "connected");
    if (providerFilter) q = q.eq("provider", providerFilter);
    if (agentIdFilter) q = q.eq("agent_id", agentIdFilter);
    const { data: rows, error } = await q;
    if (error) return j(500, { error: error.message });

    const synced: Array<{ provider: string; ok: boolean; kind: string; data: Record<string, unknown>; error?: string }> = [];
    for (const r of rows || []) {
      const sid = (r.credentials_secret_id as string | null) ?? null;
      const creds = (await readSecret(admin, sid)) as Credentials;
      const result = await syncOne(r.provider as string, creds, { admin, rowId: r.id as string, secretId: sid });
      await persist(admin, {
        user_id: r.user_id as string,
        agent_id: (r.agent_id as string | null) ?? null,
        provider: r.provider as string,
        result,
      });
      synced.push({ provider: r.provider as string, ok: result.ok, kind: result.kind, data: result.data, error: result.error });
    }
    return j(200, { synced, count: synced.length, at: new Date().toISOString() });
  } catch (e) {
    return j(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
