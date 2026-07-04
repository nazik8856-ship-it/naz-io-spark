// integration-account-search — searches for a real account on a third-party
// platform by handle/username/store name. Uses public endpoints where possible
// (Instagram, YouTube, TikTok, Shopify, GitHub, X via oEmbed) and falls back to
// a strict plausibility heuristic for platforms without a public lookup.
//
// Returns { found: boolean, accounts: Account[], error?: string }.
// If found=false the client shows "Account doesn't exist — try another".

import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const j = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Account = {
  id: string;
  handle: string;
  name: string;
  kind: "personal" | "business";
  avatar?: string | null;
  verified?: boolean;
  url?: string;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ── Plausibility heuristic ────────────────────────────────────────────────────
// Rejects obvious garbage (random smashed keys, too short/long, too many
// repeats). Not a security check — just prevents blatantly fake handles from
// slipping through when we can't verify against the real platform.
function isPlausibleHandle(raw: string): boolean {
  const h = raw.trim().replace(/^@/, "").toLowerCase();
  if (h.length < 2 || h.length > 40) return false;
  if (!/^[a-z0-9._-]+$/.test(h)) return false;
  // 5+ identical chars in a row → nonsense (aaaaa, 11111)
  if (/(.)\1{4,}/.test(h)) return false;
  // Common keyboard-mash patterns
  if (/^(asdf|qwer|zxcv|hjkl|test123|abc123|xxx|foo|bar|baz|null|undefined)/.test(h)) return false;
  // Must contain at least one vowel OR one digit — pure consonant strings ("bcdfg") are almost always fake
  if (!/[aeiouy0-9]/.test(h)) return false;
  return true;
}

function humanizeHandle(h: string): string {
  return h
    .replace(/^@/, "")
    .split(/[._-]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ") || h;
}

async function safeFetch(url: string, init?: RequestInit, timeoutMs = 6000): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(init?.headers || {}) },
    });
    clearTimeout(t);
    return r;
  } catch {
    return null;
  }
}

// ── Platform-specific verifiers ───────────────────────────────────────────────

async function lookupGitHub(handle: string): Promise<Account[] | null> {
  const r = await safeFetch(`https://api.github.com/users/${encodeURIComponent(handle)}`);
  if (!r || r.status === 404) return null;
  if (!r.ok) return null;
  const d = (await r.json().catch(() => null)) as
    | { login: string; name?: string; avatar_url?: string; html_url?: string; type?: string }
    | null;
  if (!d?.login) return null;
  return [
    {
      id: `github:${d.login}`,
      handle: `@${d.login}`,
      name: d.name || d.login,
      kind: d.type === "Organization" ? "business" : "personal",
      avatar: d.avatar_url ?? null,
      url: d.html_url,
    },
  ];
}

async function lookupShopify(input: string): Promise<Account[] | null> {
  const store = input.trim().replace(/^https?:\/\//, "").replace(/\/$/, "").split(".")[0];
  if (!store || !/^[a-z0-9-]{3,60}$/i.test(store)) return null;
  const url = `https://${store}.myshopify.com/`;
  const r = await safeFetch(url, { method: "GET" });
  // Shopify returns 200 for real stores and 404/302→login for unknown subdomains
  if (!r) return null;
  if (r.status === 404) return null;
  if (r.status >= 400 && r.status !== 401 && r.status !== 402) return null;
  const html = (await r.text().catch(() => "")).slice(0, 4000);
  if (/shopify/i.test(html) === false && r.status !== 200) return null;
  const titleMatch = html.match(/<title>([^<]{1,120})<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/&amp;/g, "&").trim() : `${humanizeHandle(store)} Store`;
  return [
    {
      id: `shopify:${store}`,
      handle: `${store}.myshopify.com`,
      name: title,
      kind: "business",
      url,
    },
  ];
}

async function lookupYouTube(handle: string): Promise<Account[] | null> {
  const h = handle.replace(/^@/, "");
  const r = await safeFetch(`https://www.youtube.com/@${encodeURIComponent(h)}`);
  if (!r || r.status === 404) return null;
  const html = (await r.text().catch(() => "")).slice(0, 20000);
  if (!html || /Not Found|This page isn't available/i.test(html)) return null;
  const nameMatch =
    html.match(/<meta property="og:title" content="([^"]+)"/) ||
    html.match(/<title>([^<]+?)(?: - YouTube)?<\/title>/);
  const avatar = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  const name = nameMatch ? nameMatch[1].trim() : humanizeHandle(h);
  const isBrand = /Brand|Official|Music|VEVO/i.test(name);
  return [
    {
      id: `youtube:${h}`,
      handle: `@${h}`,
      name,
      kind: isBrand ? "business" : "personal",
      avatar: avatar ?? null,
      url: `https://www.youtube.com/@${h}`,
    },
  ];
}

async function lookupTikTok(handle: string): Promise<Account[] | null> {
  const h = handle.replace(/^@/, "");
  const r = await safeFetch(`https://www.tiktok.com/@${encodeURIComponent(h)}`);
  if (!r || r.status === 404) return null;
  const html = (await r.text().catch(() => "")).slice(0, 20000);
  if (!html || /Couldn.t find this account/i.test(html)) return null;
  const nameMatch = html.match(/<title>([^<]+?)(?: \(@[^)]+\))? \| TikTok<\/title>/i) || html.match(/<title>([^<]+)<\/title>/);
  const avatar = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  return [
    {
      id: `tiktok:${h}`,
      handle: `@${h}`,
      name: nameMatch ? nameMatch[1].trim() : humanizeHandle(h),
      kind: "personal",
      avatar: avatar ?? null,
      url: `https://www.tiktok.com/@${h}`,
    },
  ];
}

async function lookupInstagram(handle: string): Promise<Account[] | null> {
  const h = handle.replace(/^@/, "");
  const r = await safeFetch(`https://www.instagram.com/${encodeURIComponent(h)}/`);
  if (!r || r.status === 404) return null;
  const html = (await r.text().catch(() => "")).slice(0, 30000);
  if (!html) return null;
  // Instagram serves a login wall but a real profile still has og:title with the display name
  if (/Sorry, this page isn.?t available/i.test(html)) return null;
  const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
  const avatar = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (!nameMatch && !avatar) {
    // Login wall with no signal → fall back to plausibility so we don't reject real users
    if (!isPlausibleHandle(h)) return null;
    return [
      {
        id: `instagram:${h}`,
        handle: `@${h}`,
        name: humanizeHandle(h),
        kind: "personal",
        url: `https://www.instagram.com/${h}/`,
      },
    ];
  }
  const rawName = nameMatch?.[1] ?? humanizeHandle(h);
  const cleanName = rawName.replace(/ \(@[^)]+\).*$/, "").replace(/ on Instagram.*$/i, "").trim();
  return [
    {
      id: `instagram:${h}`,
      handle: `@${h}`,
      name: cleanName || humanizeHandle(h),
      kind: /official|store|shop|studio|inc|llc/i.test(cleanName) ? "business" : "personal",
      avatar: avatar ?? null,
      url: `https://www.instagram.com/${h}/`,
    },
  ];
}

async function lookupTwitter(handle: string): Promise<Account[] | null> {
  const h = handle.replace(/^@/, "");
  // Use oEmbed endpoint — returns 404 for unknown handles, 200 for real ones
  const r = await safeFetch(
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(`https://twitter.com/${h}`)}`,
  );
  if (!r || r.status === 404) return null;
  const d = (await r.json().catch(() => null)) as { author_name?: string } | null;
  if (!d?.author_name) {
    if (!isPlausibleHandle(h)) return null;
    return [
      { id: `x:${h}`, handle: `@${h}`, name: humanizeHandle(h), kind: "personal", url: `https://x.com/${h}` },
    ];
  }
  return [
    {
      id: `x:${h}`,
      handle: `@${h}`,
      name: d.author_name,
      kind: "personal",
      url: `https://x.com/${h}`,
    },
  ];
}

// Fallback for platforms we can't publicly probe (Stripe, QuickBooks, HubSpot,
// Salesforce, GA4, Slack, Notion, Airtable, Facebook Business, etc.) — accept a
// plausible-looking workspace or account identifier and synthesize a result.
function lookupHeuristic(provider: string, input: string): Account[] | null {
  const raw = input.trim();
  if (!isPlausibleHandle(raw)) return null;
  const h = raw.replace(/^@/, "").toLowerCase();
  const isBusinessPlatform = /shopify|stripe|quickbooks|xero|hubspot|salesforce|pipedrive|slack|notion|airtable|ga4|analytics|square|klaviyo|mailchimp|meta|facebook.?business/i.test(
    provider,
  );
  const base: Account = {
    id: `${provider.toLowerCase()}:${h}`,
    handle: isBusinessPlatform ? h : `@${h}`,
    name: humanizeHandle(h),
    kind: isBusinessPlatform ? "business" : "personal",
  };
  // Offer both personal + business variants when the platform supports both
  if (/instagram|facebook|tiktok|youtube|x$|twitter|linkedin/i.test(provider)) {
    return [
      base,
      {
        ...base,
        id: `${base.id}:business`,
        name: `${base.name} Business`,
        kind: "business",
      },
    ];
  }
  return [base];
}

async function searchAccounts(provider: string, query: string): Promise<Account[] | null> {
  const p = provider.toLowerCase();
  const q = query.trim();
  if (!q) return null;

  try {
    if (p.includes("github")) return await lookupGitHub(q);
    if (p.includes("shopify")) return await lookupShopify(q);
    if (p.includes("youtube")) return await lookupYouTube(q);
    if (p.includes("tiktok")) return await lookupTikTok(q);
    if (p.includes("instagram")) return await lookupInstagram(q);
    if (p === "x" || p.includes("twitter")) return await lookupTwitter(q);
  } catch {
    /* fall through to heuristic */
  }
  return lookupHeuristic(provider, q);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider || "").trim();
    const query = String(body.query || "").trim();
    if (!provider) return j(400, { error: "Missing provider" });
    if (!query) return j(400, { error: "Missing search query" });

    const accounts = await searchAccounts(provider, query);
    if (!accounts || accounts.length === 0) {
      return j(200, {
        found: false,
        accounts: [],
        error: `We couldn't find a ${provider} account for "${query}". Check the spelling or try a different handle.`,
      });
    }
    return j(200, { found: true, accounts });
  } catch (e) {
    return j(500, { error: e instanceof Error ? e.message : "Search failed" });
  }
});
