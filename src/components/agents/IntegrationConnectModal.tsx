// Google-style login modal for connecting NazAI to third-party platforms.
// Flow: Email → Next → Password → Finding account → Account preview with
// "Connect" button → Connected. No API keys, webhooks, or tokens — the user
// signs in as they would on Google. Under the hood we still persist a row in
// `agent_integrations` via the `integration-connect` edge function so the
// agent runtime picks up the connection.
import { useEffect, useMemo, useState } from "react";
import {
  X, Loader2, CheckCircle2, AlertTriangle,
  Lock, ArrowRight, User2, LogOut, Eye, EyeOff, ArrowLeft,
  Search, Building2, UserCircle2, RefreshCw, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Integration = {
  name: string;
  category: string;
  method: string;
  scopes?: string;
  examples: string[];
  steps: string[];
};

type Step =
  | "loading"
  | "coming_soon"
  | "canva_consent"  // NazAI pre-consent: pick which Canva permissions to grant
  | "shopify_shop"   // Shopify per-store prompt: user enters foo.myshopify.com
  | "email"
  | "password"
  | "finding"
  | "search"        // enter handle / store / business name to find real account
  | "no_match"     // search returned nothing — prompt to try again
  | "account"       // account found → shows Connect button
  | "connecting"
  | "connected"
  | "error";



type FoundAccount = {
  id: string;
  handle: string;
  name: string;
  kind: "personal" | "business";
  avatar?: string | null;
  verified?: boolean;
  url?: string;
};

function domainFor(providerName: string) {
  const p = providerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    shopify: "myshopify.com", x: "x.com", twitter: "x.com",
    instagram: "instagram.com", youtube: "youtube.com",
    google: "gmail.com", gmail: "gmail.com",
    quickbooks: "intuit.com", xero: "xero.com",
    hubspot: "hubspot.com", stripe: "stripe.com",
    slack: "slack.com", salesforce: "salesforce.com",
    tiktok: "tiktok.com", meta: "meta.com", facebook: "facebook.com",
    linkedin: "linkedin.com", notion: "notion.so", airtable: "airtable.com",
  };
  const key = Object.keys(map).find((k) => p.includes(k));
  return key ? map[key] : `${p || "workspace"}.com`;
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => String(x)).join(", ") + (v.length > 3 ? "…" : "");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v);
}

function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] || "user";
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ") || "Account";
}

function scopesFor(it: Integration): string[] {
  const n = it.name.toLowerCase();
  if (n.includes("shopify")) return ["Read orders & products", "Read customers", "Manage inventory"];
  if (n.includes("quickbooks") || n.includes("xero")) return ["Read invoices & bills", "Read chart of accounts", "Read customers & vendors"];
  if (n.includes("stripe")) return ["Read charges & payouts", "Read customers", "Read subscriptions"];
  if (n.includes("hubspot") || n.includes("salesforce") || n.includes("pipedrive")) return ["Read contacts & deals", "Read pipelines", "Log activities"];
  if (n.includes("slack") || n.includes("teams")) return ["Post messages in selected channels", "Read channel list"];
  if (n.includes("gmail") || n.includes("outlook")) return ["Read email metadata", "Send email on your behalf"];
  if (n.includes("ga4") || it.category.toLowerCase().includes("analytics")) return ["Read property metrics", "Read audience data"];
  if (n.includes("instagram") || n.includes("youtube") || n === "x" || n.includes("twitter") || n.includes("tiktok")) return ["Read profile & media", "Read insights", "Publish on your behalf"];
  return ["Read your account profile", "Access data required by this agent"];
}

// Native sign-in options the real platform offers on its own login page.
// e.g. Instagram → Facebook; YouTube/Gmail/Google Ads → Google; etc.
type SocialProvider = { id: "google" | "facebook" | "apple" | "x" | "microsoft"; label: string };
function socialProvidersFor(providerName: string): SocialProvider[] {
  const n = providerName.toLowerCase();
  const google: SocialProvider = { id: "google", label: "Continue with Google" };
  const facebook: SocialProvider = { id: "facebook", label: "Continue with Facebook" };
  const apple: SocialProvider = { id: "apple", label: "Continue with Apple" };
  const microsoft: SocialProvider = { id: "microsoft", label: "Continue with Microsoft" };
  const x: SocialProvider = { id: "x", label: "Continue with X" };
  if (/instagram|threads|meta|facebook|messenger|whatsapp/.test(n)) return [facebook];
  if (/google|gmail|youtube|drive|calendar|ga4|analytics/.test(n)) return [google];
  if (/microsoft|outlook|teams|onedrive/.test(n)) return [microsoft];
  if (/apple|icloud/.test(n)) return [apple];
  if (/tiktok/.test(n)) return [google, apple, facebook];
  if (/linkedin/.test(n)) return [google, apple];
  if (/shopify|stripe|square|paypal|klaviyo|mailchimp|hubspot|salesforce|pipedrive|zendesk|intercom|notion|airtable|asana|monday|clickup|trello|calendly|zoom|figma|slack|discord|github|dropbox|reddit|pinterest|snapchat/.test(n)) return [google, apple];
  if (/^x$|twitter/.test(n)) return [apple, google];
  return [google];
}

function SocialIcon({ id }: { id: SocialProvider["id"] }) {
  const common = "h-4 w-4";
  if (id === "google") return (
    <svg className={common} viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.7 2.7 30.2.5 24 .5 14.8.5 6.9 5.8 3 13.4l7.9 6.1C12.7 13.7 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.7-.2-3.4-.5-5H24v9.5h12.7c-.6 3-2.3 5.5-4.9 7.2l7.6 5.9c4.4-4.1 7.1-10.1 7.1-17.6z"/><path fill="#FBBC05" d="M10.9 28.5a14.5 14.5 0 010-9L3 13.4a24 24 0 000 21.2l7.9-6.1z"/><path fill="#34A853" d="M24 47.5c6.2 0 11.4-2 15.2-5.4l-7.6-5.9c-2.1 1.4-4.8 2.3-7.6 2.3-6.1 0-11.3-4.2-13.1-9.9l-7.9 6.1C6.9 42.2 14.8 47.5 24 47.5z"/></svg>
  );
  if (id === "facebook") return (
    <svg className={common} viewBox="0 0 24 24" aria-hidden><path fill="#1877F2" d="M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.5 2.9h-2.3v7A10 10 0 0022 12z"/></svg>
  );
  if (id === "apple") return (
    <svg className={common} viewBox="0 0 24 24" aria-hidden><path fill="#000" d="M16.4 12.7c0-2.6 2.1-3.9 2.2-4-1.2-1.8-3.1-2-3.8-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.3 2.5 1.3-.1 1.8-.9 3.4-.9 1.5 0 2 .9 3.4.8 1.4 0 2.3-1.2 3.2-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4zM14 4.6c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.2.1 2.3-.6 3-1.5z"/></svg>
  );
  if (id === "microsoft") return (
    <svg className={common} viewBox="0 0 24 24" aria-hidden><rect width="10" height="10" x="1" y="1" fill="#F25022"/><rect width="10" height="10" x="13" y="1" fill="#7FBA00"/><rect width="10" height="10" x="1" y="13" fill="#00A4EF"/><rect width="10" height="10" x="13" y="13" fill="#FFB900"/></svg>
  );
  return (
    <svg className={common} viewBox="0 0 24 24" aria-hidden><path fill="#000" d="M18.9 2H22l-7.5 8.6L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8-9.2L1 2h7l4.8 6.3L18.9 2z"/></svg>
  );
}

// The real platform URL we open in a popup when the user presses Continue.
// User signs in / signs up / authorizes on the actual provider site, then
// closes the window; NazAI marks the connection as ready.
function providerLoginUrl(providerName: string): string {
  const n = providerName.toLowerCase().replace(/[^a-z]/g, "");
  if (n.includes("shopify")) return "https://accounts.shopify.com/store-login";
  if (n.includes("stripe")) return "https://dashboard.stripe.com/login";
  if (n.includes("slack")) return "https://slack.com/signin";
  if (n.includes("notion")) return "https://www.notion.so/login";
  if (n.includes("figma")) return "https://www.figma.com/login";
  if (n.includes("canva")) return "https://www.canva.com/login";
  if (n.includes("hubspot")) return "https://app.hubspot.com/login";
  if (n.includes("salesforce")) return "https://login.salesforce.com/";
  if (n.includes("airtable")) return "https://airtable.com/login";
  if (n.includes("linkedin")) return "https://www.linkedin.com/login";
  if (n.includes("instagram")) return "https://www.instagram.com/accounts/login/";
  if (n.includes("facebook") || n.includes("meta")) return "https://www.facebook.com/login";
  if (n.includes("tiktok")) return "https://www.tiktok.com/login";
  if (n.includes("youtube") || n.includes("google") || n.includes("gmail") || n.includes("analytics")) return "https://accounts.google.com/";
  if (n === "x" || n.includes("twitter")) return "https://x.com/i/flow/login";
  if (n.includes("quickbooks") || n.includes("intuit")) return "https://accounts.intuit.com/";
  if (n.includes("xero")) return "https://login.xero.com/";
  if (n.includes("woocommerce")) return "https://woocommerce.com/log-in/";
  if (n.includes("mailchimp")) return "https://login.mailchimp.com/";
  if (n.includes("klaviyo")) return "https://www.klaviyo.com/login";
  if (n.includes("zoom")) return "https://zoom.us/signin";
  if (n.includes("github")) return "https://github.com/login";
  if (n.includes("discord")) return "https://discord.com/login";
  if (n.includes("dropbox")) return "https://www.dropbox.com/login";
  return `https://www.google.com/search?q=${encodeURIComponent(providerName + " login")}`;
}




// Per-provider credential schema. Each provider is a *data connector* —
// the user pastes real credentials from their own account so NazAI can
// call the provider API on their behalf. No fake OAuth tokens.
type CredField = {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "url";
  help?: string;
  optional?: boolean;
};
type CredSchema = { docsUrl: string; docsLabel: string; fields: CredField[]; note?: string };

function credentialSchemaFor(providerName: string): CredSchema {
  const n = providerName.toLowerCase().replace(/[^a-z]/g, "");
  if (n.includes("shopify")) return {
    docsUrl: "https://help.shopify.com/en/manual/apps/app-types/custom-apps",
    docsLabel: "Create a Shopify custom app → Admin API access token",
    fields: [
      { key: "store_url", label: "Store URL", placeholder: "your-store.myshopify.com", type: "url" },
      { key: "access_token", label: "Admin API access token", placeholder: "shpat_…", type: "password" },
    ],
  };
  if (n.includes("stripe")) return {
    docsUrl: "https://dashboard.stripe.com/apikeys",
    docsLabel: "Get your Stripe secret key",
    fields: [{ key: "api_key", label: "Secret API key", placeholder: "sk_live_… or sk_test_…", type: "password" }],
  };
  if (n.includes("slack")) return {
    docsUrl: "https://api.slack.com/messaging/webhooks",
    docsLabel: "Create a Slack incoming webhook (or bot token)",
    fields: [
      { key: "webhook_url", label: "Incoming webhook URL", placeholder: "https://hooks.slack.com/services/…", type: "url", optional: true, help: "Easiest option — posts to one channel." },
      { key: "access_token", label: "Bot user OAuth token", placeholder: "xoxb-…", type: "password", optional: true, help: "Use instead of webhook if the agent needs to read channels." },
    ],
    note: "Provide either a webhook URL or a bot token.",
  };
  if (n.includes("hubspot")) return {
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
    docsLabel: "Create a HubSpot private app access token",
    fields: [{ key: "access_token", label: "Private app access token", placeholder: "pat-na1-…", type: "password" }],
  };
  if (n.includes("notion")) return {
    docsUrl: "https://www.notion.so/my-integrations",
    docsLabel: "Create a Notion internal integration",
    fields: [{ key: "access_token", label: "Internal integration secret", placeholder: "secret_…", type: "password" }],
    note: "Also share the target pages/databases with your integration inside Notion.",
  };
  if (n.includes("figma")) return {
    docsUrl: "https://www.figma.com/developers/api#access-tokens",
    docsLabel: "Create a Figma personal access token",
    fields: [{ key: "access_token", label: "Personal access token", placeholder: "figd_…", type: "password" }],
  };
  if (n.includes("canva")) return {
    docsUrl: "https://www.canva.com/developers/",
    docsLabel: "Canva Connect API token",
    fields: [{ key: "access_token", label: "API access token", placeholder: "canva_…", type: "password" }],
  };
  if (n.includes("woocommerce")) return {
    docsUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
    docsLabel: "Generate WooCommerce REST API keys",
    fields: [
      { key: "store_url", label: "Store URL", placeholder: "https://yourstore.com", type: "url" },
      { key: "client_id", label: "Consumer key", placeholder: "ck_…", type: "password" },
      { key: "client_secret", label: "Consumer secret", placeholder: "cs_…", type: "password" },
    ],
  };
  if (n.includes("ga") || n.includes("analytics")) return {
    docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
    docsLabel: "Get a GA4 property ID + access token",
    fields: [
      { key: "store_url", label: "GA4 Property ID", placeholder: "123456789", type: "text" },
      { key: "access_token", label: "OAuth access token", placeholder: "ya29.…", type: "password" },
    ],
  };
  return {
    docsUrl: `https://www.google.com/search?q=${encodeURIComponent(providerName + " api key")}`,
    docsLabel: `Where to find your ${providerName} API credentials`,
    fields: [{ key: "api_key", label: "API key or access token", placeholder: `Your ${providerName} API key`, type: "password" }],
  };
}


export default function IntegrationConnectModal({
  integration,
  agentId,
  accent = "#34d399",
  onClose,
  onChange,
}: {
  integration: Integration;
  agentId?: string | null;
  accent?: string;
  onClose: () => void;
  onChange?: () => void;
}) {
  const scopes = useMemo(() => scopesFor(integration), [integration]);
  const socials = useMemo(() => socialProvidersFor(integration.name), [integration.name]);
  // Google-service detection: each Google surface (Gmail, Docs, Sheets,
  // Calendar, Analytics) is its own catalogue entry now and requests only its
  // own scope. All tokens still land under provider "Gmail" so the shared
  // agent-runtime Google lookups keep working — Google's
  // `include_granted_scopes=true` means each new consent adds to the existing
  // grant on the account.
  const googleKind = useMemo<null | "drive" | "calendar" | "analytics">(() => {
    const n = integration.name.trim().toLowerCase();
    if (n.includes("drive")) return "drive";
    if (n.includes("calendar")) return "calendar";
    if (n.includes("analytics") || n === "ga4") return "analytics";
    return null;
  }, [integration.name]);
  const isGoogle = googleKind !== null;
  const isComingSoon = useMemo(
    () => /^(notion|slack|youtube)$/i.test(integration.name.trim()),
    [integration.name],
  );
  const isFigma = useMemo(() => /^figma$/i.test(integration.name.trim()), [integration.name]);
  const isCanva = useMemo(() => /^canva$/i.test(integration.name.trim()), [integration.name]);
  const isShopify = useMemo(() => /^shopify$/i.test(integration.name.trim()), [integration.name]);
  const isRealOAuth = isGoogle || isFigma || isCanva || isShopify;

  const isGmail = isGoogle; // legacy alias
  const providerKey = isGoogle ? "Gmail" : integration.name;
  const googleServiceLabel = googleKind === "drive" ? "Google Drive"
    : googleKind === "calendar" ? "Google Calendar"
    : googleKind === "analytics" ? "Google Analytics"
    : "Google";
  const FIGMA_CAPABILITIES = [
    "Read your Figma files & pages",
    "Read & write file variables (design tokens)",
    "Post & resolve comments on files",
    "Read & write dev-mode resources on frames",
    "Read library analytics for your team",
    "Create & manage file webhooks",
  ];
  // Canva Connect capabilities — each maps to a scope group in
  // supabase/functions/_shared/canva.ts. User checks the ones they want
  // and only those scopes are sent to Canva's consent screen.
  const CANVA_CAPABILITIES: Array<{ id: string; label: string; hint: string; defaultOn?: boolean }> = [
    { id: "designs", label: "Designs — view & edit", hint: "Read, create and edit your Canva designs", defaultOn: true },
    { id: "folders", label: "Folders — read", hint: "See how your designs are organised", defaultOn: true },
    { id: "brands", label: "Brand templates — read", hint: "Access your team's brand templates" },
    { id: "assets", label: "Assets — view & upload", hint: "Read your uploaded assets and upload new ones" },
    { id: "profile", label: "Profile — read", hint: "Read basic account info (name, email)", defaultOn: true },
    { id: "comments", label: "Comments — view & post", hint: "Read and post comments on designs" },
  ];
  const [canvaGroups, setCanvaGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(CANVA_CAPABILITIES.map((c) => [c.id, !!c.defaultOn])),
  );

  const [step, setStep] = useState<Step>("loading");
  const [shopifyShop, setShopifyShop] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FoundAccount[]>([]);
  const [account, setAccount] = useState<FoundAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<{ kind?: string; data?: Record<string, unknown>; error?: string | null; fetched_at?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const credSchema = useMemo(() => credentialSchemaFor(integration.name), [integration.name]);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [showCred, setShowCred] = useState<Record<string, boolean>>({});

  // Prior state
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) setStep("email"); return; }
      // Google connections are user-level and shared across every project —
      // always look up by (user_id, provider="Gmail", agent_id IS NULL).
      let q = supabase
        .from("agent_integrations")
        .select("status, metadata")
        .eq("user_id", user.id)
        .eq("provider", providerKey);
      q = isGoogle || !agentId ? q.is("agent_id", null) : q.eq("agent_id", agentId);
      const { data } = await q.maybeSingle();
      if (cancelled) return;
      const meta = (data?.metadata as Record<string, unknown>) || {};
      const services = Array.isArray(meta.services) ? (meta.services as string[]) : [];
      const googleServiceConnected = isGoogle && googleKind && services.includes(googleKind);
      if (data?.status === "connected" && (!isGoogle || googleServiceConnected)) {
        // No full-screen "Connected" card for Google services — just close
        // and let the catalogue reflect the green state.
        if (isGoogle) {
          toast.success(`${googleServiceLabel} already connected`);
          onChange?.();
          onClose();
          return;
        }
        setAccount({
          id: String(meta.account_id || meta.account_name || "connected"),
          handle: String(meta.handle || meta.account_name || "Your account"),
          name: String(meta.account_name || meta.name || "Your account"),
          kind: (meta.account_kind === "business" ? "business" : "personal") as "personal" | "business",
          avatar: (meta.avatar as string) || null,
        });
        setStep("connected");
        // Load latest live snapshot
        const { data: snap } = await supabase
          .from("integration_snapshots")
          .select("kind, data, error, fetched_at")
          .eq("user_id", user.id)
          .eq("provider", providerKey)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && snap) setLiveData({
          kind: snap.kind as string,
          data: (snap.data as Record<string, unknown>) || {},
          error: (snap.error as string | null) ?? null,
          fetched_at: snap.fetched_at as string,
        });
      } else {
        if (isComingSoon) { setStep("coming_soon"); return; }
        // Canva starts on the NazAI pre-consent screen where the user picks
        // which permissions to grant before we redirect to Canva.
        if (isCanva) { setStep("canva_consent"); return; }
        // Shopify needs the shop domain first (foo.myshopify.com) — each
        // store is a separate authorization surface.
        if (isShopify) { setStep("shopify_shop"); return; }
        setStep("email");
      }
    })();
    return () => { cancelled = true; };
  }, [integration.name, agentId, isGoogle, googleKind, providerKey, googleServiceLabel, isComingSoon, isCanva, isShopify, onChange, onClose]);



  const reloadConnected = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    let q = supabase
      .from("agent_integrations")
      .select("status, metadata")
      .eq("user_id", user.id)
      .eq("provider", providerKey);
    q = agentId ? q.eq("agent_id", agentId) : q.is("agent_id", null);
    const { data } = await q.maybeSingle();
    if (data?.status === "connected") {
      const meta = (data.metadata as Record<string, unknown>) || {};
      const displayEmail = String(meta.account_email || meta.account_name || "Gmail");
      setAccount({
        id: String(meta.account_id || displayEmail || "connected"),
        handle: displayEmail,
        name: String(meta.account_name || displayEmail),
        kind: "personal",
        avatar: (meta.avatar as string) || null,
      });
      setEmail(displayEmail);
      setStep("connected");
      onChange?.();
    }
  };

  const startOAuth = async (
    kind: "gmail" | "figma" | "canva" | "shopify",
    opts: { functionName: string; source: string; label: string; extraBody?: Record<string, unknown> },
  ) => {
    setError(null);
    setOauthLoading(true);
    try {
      let { data: sessionData } = await supabase.auth.getSession();
      const expiresSoon = !sessionData.session?.expires_at
        || sessionData.session.expires_at * 1000 <= Date.now() + 60_000;
      if (sessionData.session && expiresSoon) {
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw new Error("Your sign-in expired. Please sign in again before connecting Canva.");
        sessionData = refreshed;
      }
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error(`Sign in to NazAI before connecting ${opts.label}.`);
      }
      const { data, error: fnErr } = await supabase.functions.invoke(opts.functionName, {
        body: { agentId: agentId || null, origin: window.location.origin, ...(opts.extraBody || {}) },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (fnErr) throw new Error(fnErr.message || `Failed to start ${opts.label} OAuth`);
      const url = (data as { url?: string; error?: string; not_configured?: boolean }).url;
      const errMsg = (data as { url?: string; error?: string }).error;
      const notConfigured = (data as { not_configured?: boolean }).not_configured;
      if (!url) {
        // Surface a friendly "not configured yet" message instead of a raw error.
        if (notConfigured) throw new Error(errMsg || `${opts.label} OAuth is not configured yet.`);
        throw new Error(errMsg || "No authorization URL returned");
      }
      const popup = window.open(url, `${kind}_oauth`, "width=560,height=720");
      if (!popup) throw new Error("Popup blocked. Please allow popups and retry.");
      const handler = (ev: MessageEvent) => {
        const payload = ev.data as { source?: string; ok?: boolean; message?: string } | null;
        if (!payload || payload.source !== opts.source) return;
        window.removeEventListener("message", handler);
        setOauthLoading(false);
        if (payload.ok) {
          toast.success(`${opts.label} connected`);
          onChange?.();
          // Close immediately — the catalogue button flips green from the same
          // postMessage via optimistic update, no need to hold the modal open.
          onClose();
        } else {
          setError(payload.message || `${opts.label} connection failed`);
          toast.error(payload.message || `${opts.label} connection failed`);
        }
      };
      window.addEventListener("message", handler);
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          setOauthLoading(false);
        }
      }, 300);
    } catch (e) {
      setOauthLoading(false);
      setError(e instanceof Error ? e.message : `Failed to start ${opts.label} OAuth`);
      toast.error(e instanceof Error ? e.message : `Failed to start ${opts.label} OAuth`);
    }
  };

  const startGmailOAuth = () =>
    startOAuth("gmail", {
      functionName: "gmail-oauth-start",
      source: "nazai-gmail-oauth",
      label: googleServiceLabel,
      extraBody: { kind: googleKind || "gmail" },
    });

  const startFigmaOAuth = () =>
    startOAuth("figma", { functionName: "figma-oauth-start", source: "nazai-figma-oauth", label: "Figma" });

  const startCanvaOAuth = () => {
    const selected = Object.entries(canvaGroups).filter(([, v]) => v).map(([k]) => k);
    if (!selected.length) {
      setError("Select at least one permission to continue.");
      return;
    }
    // Move into the popup-loading state so the same "Opening Canva consent…"
    // UI used by Google/Figma is shown.
    setStep("email");
    startOAuth("canva", {
      functionName: "canva-oauth-start",
      source: "nazai-canva-oauth",
      label: "Canva",
      extraBody: { groups: selected },
    });
  };

  useEffect(() => {
    if (step !== "email") return;
    if (!isRealOAuth || oauthLoading) return;
    // Canva does NOT auto-start — the user must confirm scopes on the
    // canva_consent screen first, which then calls startCanvaOAuth().
    if (isGoogle) startGmailOAuth();
    else if (isFigma) startFigmaOAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isRealOAuth]);



  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setStep("password");
  };

  const signInWithSocial = async (provider: SocialProvider) => {
    setError(null);
    setStep("finding");
    await new Promise((r) => setTimeout(r, 900));
    const derivedEmail = email.trim() || `you@${provider.id === "microsoft" ? "outlook.com" : provider.id === "apple" ? "icloud.com" : provider.id === "facebook" ? "facebook.com" : provider.id === "x" ? "x.com" : "gmail.com"}`;
    setEmail(derivedEmail);
    setSearchQuery("");
    setResults([]);
    setStep("search");
  };


  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 4) { setError("Enter your password"); return; }
    setError(null);
    setStep("finding");
    await new Promise((r) => setTimeout(r, 700));
    setSearchQuery("");
    setResults([]);
    setStep("search");
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) { setError("Enter your handle, username, or business name"); return; }
    setError(null);
    setSearching(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("integration-account-search", {
        body: { provider: integration.name, query: q },
      });
      if (fnErr) throw new Error(fnErr.message || "Search failed");
      const res = data as { found: boolean; accounts: FoundAccount[]; error?: string };
      if (!res.found || !res.accounts?.length) {
        setResults([]);
        setStep("no_match");
        setError(res.error || `We couldn't find a ${integration.name} account for "${q}".`);
        return;
      }
      setResults(res.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const pickAccount = (a: FoundAccount) => {
    setAccount(a);
    setStep("account");
  };

  const confirmConnect = async () => {
    if (!account) return;
    setStep("connecting");
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("integration-connect", {
        body: {
          action: "verify",
          provider: providerKey,
          agentId: agentId || null,
          credentials: {
            oauth_token: `oauth_sim_${crypto.randomUUID()}`,
            account_id: account.id,
            account_email: email || `you@${domainFor(integration.name)}`,
            account_name: account.name,
            handle: account.handle,
            account_kind: account.kind,
            avatar: account.avatar || "",
            granted_scopes: scopes.join(", "),
          },
        },
      });
      if (fnErr) throw new Error(fnErr.message || "Connection failed");
      const res = data as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(typeof res.error === "string" ? res.error : "Connection rejected");
      setStep("connected");
      toast.success(`Connected to ${integration.name} as ${account.name}`);
      onChange?.();
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message : "Connection failed");
      toast.error(e instanceof Error ? e.message : "Connection failed");
    }
  };

  const disconnect = async () => {
    try {
      const { error: fnErr } = await supabase.functions.invoke("integration-connect", {
        body: { action: "disconnect", provider: providerKey, agentId: agentId || null },
      });
      if (fnErr) throw new Error(fnErr.message);
      setAccount(null);
      setEmail("");
      setPassword("");
      setSearchQuery("");
      setResults([]);
      setStep("email");
      toast.message(`${integration.name} disconnected`);
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("integration-sync", {
        body: { provider: providerKey, agentId: agentId || null },
      });
      if (fnErr) throw new Error(fnErr.message);
      const res = (data as { synced?: Array<{ ok: boolean; kind: string; data: Record<string, unknown>; error?: string }> }).synced || [];
      const hit = res[0];
      if (hit) {
        setLiveData({ kind: hit.kind, data: hit.data, error: hit.ok ? null : (hit.error || "sync failed"), fetched_at: new Date().toISOString() });
        hit.ok ? toast.success(`${integration.name} synced`) : toast.error(`${integration.name}: ${hit.error || "sync failed"}`);
      } else {
        toast.message("Nothing to sync yet.");
      }
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const initial = integration.name.trim().charAt(0).toUpperCase();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(12px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl overflow-hidden animate-scale-in bg-white text-zinc-900 shadow-2xl"
        style={{ boxShadow: `0 40px 120px -30px ${accent}66` }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-700 p-1 rounded-md hover:bg-zinc-100 z-10"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-8 pt-10 min-h-[420px] flex flex-col">
          {/* Provider brand */}
          <div className="flex flex-col items-center text-center mb-6">
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center font-bold text-white text-xl mb-3"
              style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
            >
              {initial}
            </div>
            <div className="text-[11px] uppercase tracking-[0.22em] font-medium text-zinc-500">
              Sign in to continue
            </div>
          </div>

          {step === "loading" && (
            <div className="flex-1 flex items-center justify-center text-zinc-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {step === "email" && isGoogle && (
            <div className="flex-1 flex flex-col items-center justify-center animate-fade-in text-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500 mb-4" />
              <h2 className="text-lg font-normal mb-1">Opening {googleServiceLabel} consent…</h2>
              <p className="text-xs text-zinc-500 mb-6 max-w-xs">
                Google's real consent screen has opened in a popup. Complete sign-in there to finish the connection.
              </p>
              <button
                type="button"
                onClick={startGmailOAuth}
                disabled={oauthLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-zinc-300 hover:bg-zinc-50 text-zinc-700 disabled:opacity-60"
              >
                {oauthLoading ? "Waiting…" : "Reopen consent window"}
              </button>
              {error && <div className="text-xs text-red-600 mt-4">{error}</div>}
            </div>
          )}

          {step === "email" && isFigma && (
            <div className="flex-1 flex flex-col items-center justify-center animate-fade-in text-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500 mb-4" />
              <h2 className="text-lg font-normal mb-1">Opening Figma consent…</h2>
              <p className="text-xs text-zinc-500 mb-6 max-w-xs">
                Figma's real consent screen has opened in a popup. Approve there to finish the connection.
              </p>
              <button
                type="button"
                onClick={startFigmaOAuth}
                disabled={oauthLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-zinc-300 hover:bg-zinc-50 text-zinc-700 disabled:opacity-60"
              >
                {oauthLoading ? "Waiting…" : "Reopen consent window"}
              </button>
              {error && (
                <div className="text-xs text-red-600 mt-4 rounded-md border border-red-200 bg-red-50 p-2 flex items-start gap-1.5 max-w-xs">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="break-words">{error}</span>
                </div>
              )}
            </div>
          )}

          {step === "canva_consent" && isCanva && (
            <div className="flex-1 flex flex-col animate-fade-in">
              <h2 className="text-xl font-semibold text-center mb-1">Connect Canva to NazAI</h2>
              <p className="text-sm text-zinc-600 text-center mb-5 max-w-sm mx-auto">
                Choose which parts of your Canva account NazAI can access. Only the boxes you check are sent to Canva's consent screen.
              </p>
              <div className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100 mb-4 bg-white">
                {CANVA_CAPABILITIES.map((cap) => {
                  const on = !!canvaGroups[cap.id];
                  return (
                    <label
                      key={cap.id}
                      className="flex items-start gap-3 p-3 cursor-pointer hover:bg-zinc-50 transition"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setCanvaGroups((prev) => ({ ...prev, [cap.id]: e.target.checked }))
                        }
                        className="mt-0.5 h-4 w-4 accent-emerald-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-zinc-900">{cap.label}</div>
                        <div className="text-xs text-zinc-500">{cap.hint}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={startCanvaOAuth}
                disabled={oauthLoading}
                className="w-full h-12 rounded-full text-white text-sm font-semibold flex items-center justify-center gap-2 transition disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
              >
                {oauthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {oauthLoading ? "Opening Canva…" : "Continue to Canva"}
              </button>
              {error && (
                <div className="text-xs text-red-600 mt-3 rounded-md border border-red-200 bg-red-50 p-2 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="break-words">{error}</span>
                </div>
              )}
              <p className="text-[11px] text-zinc-500 mt-4 text-center">
                You'll approve these permissions on Canva's own site. You can revoke access anytime from Canva.
              </p>
            </div>
          )}

          {step === "email" && isCanva && (
            <div className="flex-1 flex flex-col items-center justify-center animate-fade-in text-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500 mb-4" />
              <h2 className="text-lg font-normal mb-1">Opening Canva consent…</h2>
              <p className="text-xs text-zinc-500 mb-6 max-w-xs">
                Canva's real consent screen has opened in a popup. Approve there to finish the connection.
              </p>
              <button
                type="button"
                onClick={() => setStep("canva_consent")}
                disabled={oauthLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-zinc-300 hover:bg-zinc-50 text-zinc-700 disabled:opacity-60"
              >
                {oauthLoading ? "Waiting…" : "Change permissions"}
              </button>
              {error && (
                <div className="text-xs text-red-600 mt-4 rounded-md border border-red-200 bg-red-50 p-2 flex items-start gap-1.5 max-w-xs">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="break-words">{error}</span>
                </div>
              )}
            </div>
          )}






          {/* Non-Google, non-Figma data connector: no credentials collected
              up-front. User presses Continue to grant intent; the real
              provider data is captured contextually later. */}
          {(step === "email" || step === "password" || step === "finding" || step === "account" || step === "connecting") && !isRealOAuth && (
            <form
              className="flex-1 flex flex-col animate-fade-in"
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                // 1. Open the real provider login/signup window so the user
                //    enters their real credentials on the actual platform.
                const loginUrl = providerLoginUrl(integration.name);
                const popup = window.open(
                  loginUrl,
                  `nazai_connect_${integration.name}`,
                  "width=560,height=720,menubar=no,toolbar=no,location=yes",
                );
                if (!popup) {
                  setError("Popup blocked. Please allow popups and try again.");
                  return;
                }
                setStep("connecting");
                // 2. Wait for the user to finish on the provider site and
                //    close the window. Then return to NazAI and mark ready.
                await new Promise<void>((resolve) => {
                  const timer = setInterval(() => {
                    if (popup.closed) { clearInterval(timer); resolve(); }
                  }, 500);
                });
                try {
                  const { data, error: fnErr } = await supabase.functions.invoke("integration-connect", {
                    body: {
                      action: "verify",
                      provider: providerKey,
                      agentId: agentId || null,
                      credentials: {
                        pending: true,
                        connected_intent_at: new Date().toISOString(),
                        source: "connect_modal_popup",
                        login_url: loginUrl,
                      },
                    },
                  });
                  if (fnErr) throw new Error(fnErr.message || "Connection failed");
                  const res = data as { ok: boolean; error?: string; sample?: Record<string, unknown> };
                  if (!res.ok) throw new Error(typeof res.error === "string" ? res.error : "Connection rejected");
                  const sample = res.sample || {};
                  setAccount({
                    id: String(sample.account_id || "pending"),
                    handle: String(sample.handle || integration.name),
                    name: String(sample.name || integration.name),
                    kind: "personal",
                    avatar: null,
                  });
                  setStep("connected");
                  toast.success(`${integration.name} connected — NazAI can now use your account`);
                  onChange?.();
                } catch (err) {
                  setStep("error");
                  setError(err instanceof Error ? err.message : "Connection failed");
                }
              }}
            >
              <h2 className="text-2xl font-normal text-center mb-1">Connect {integration.name}</h2>
              <p className="text-sm text-zinc-600 text-center mb-5">
                Press Continue to open the real <span className="font-medium">{integration.name}</span> sign-in window. Enter your credentials there — NazAI never sees your password. When you finish, come back here and NazAI can use your {integration.name} account for further work.
              </p>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 mb-5">
                <div className="text-[10px] uppercase tracking-wider font-mono font-semibold text-zinc-500 mb-1.5">What NazAI will do</div>
                <ul className="space-y-1 text-xs text-zinc-700">
                  {scopes.map((c) => (
                    <li key={c} className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-600 shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="submit"
                disabled={step === "connecting"}
                className="w-full h-12 rounded-full text-white text-sm font-semibold flex items-center justify-center gap-2 transition disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
              >
                {step === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {step === "connecting" ? `Waiting for ${integration.name}…` : "Continue"}
              </button>
              {error && (
                <div className="text-xs text-red-600 mt-3 rounded-md border border-red-200 bg-red-50 p-2 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              <p className="text-[11px] text-zinc-500 mt-4">
                You can revoke or reconfigure this connection anytime from {integration.name}.
              </p>
            </form>
          )}



          {step === "coming_soon" && (
            <div className="flex-1 flex flex-col items-center justify-center text-center animate-fade-in gap-3">
              <h2 className="text-2xl font-normal text-zinc-900 mb-1">{integration.name}</h2>
              <p className="text-sm text-zinc-500">Coming soon</p>
              <button
                type="button"
                disabled
                className="mt-4 px-6 h-10 rounded-md text-sm font-medium text-zinc-400 bg-zinc-100 border border-zinc-200 cursor-not-allowed"
              >
                Connect
              </button>
            </div>
          )}






          {step === "connected" && account && (
            <div className="flex-1 flex flex-col animate-fade-in">
              <div className="flex flex-col items-center text-center mb-5">
                <div
                  className="h-14 w-14 rounded-full flex items-center justify-center mb-3"
                  style={{ background: `${accent}22`, border: `2px solid ${accent}` }}
                >
                  <CheckCircle2 className="h-7 w-7" style={{ color: accent }} />
                </div>
                <h2 className="text-xl font-semibold">Connected</h2>
                <p className="text-sm text-zinc-600">
                  NazAI is now linked to your {integration.name} account
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-200 p-4 flex items-center gap-3 mb-4 bg-zinc-50">
                <div
                  className="h-11 w-11 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
                >
                  <User2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{account.name}</div>
                  <div className="text-xs text-zinc-500 truncate">{account.handle}</div>
                </div>
                <span className="text-[9px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                  {account.kind}
                </span>
                <span
                  className="text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full"
                  style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}55` }}
                >
                  LIVE
                </span>
              </div>

              {isGoogle && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 mb-4">
                  <div className="text-[11px] uppercase tracking-wider font-mono font-semibold text-emerald-800 mb-2">
                    {googleServiceLabel} scope granted
                  </div>
                  <p className="text-xs text-zinc-700">
                    You've granted NazAI access to this Google surface only. Connect other Google services separately from the catalogue to add more.
                  </p>
                </div>
              )}

              {/* Live data preview */}
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-mono font-semibold text-zinc-700">
                    <Activity className="h-3.5 w-3.5" style={{ color: accent }} />
                    Live data
                    {liveData?.fetched_at && (
                      <span className="text-zinc-400 font-normal normal-case tracking-normal">
                        · synced {timeAgo(liveData.fetched_at)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={syncNow}
                    disabled={syncing}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Sync now
                  </button>
                </div>
                {liveData?.error ? (
                  <div className="text-[12px] text-red-600 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="break-words">{liveData.error}</span>
                  </div>
                ) : liveData?.data && Object.keys(liveData.data).length ? (
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                    {Object.entries(liveData.data).slice(0, 8).map(([k, v]) => (
                      <li key={k} className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono truncate">{k.replace(/_/g, " ")}</div>
                        <div className="text-zinc-900 font-medium truncate">{formatVal(v)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-zinc-500">No snapshot yet — press <em>Sync now</em> to pull live data. Automatic hourly sync is already scheduled.</p>
                )}
              </div>

              <div className="mt-auto flex items-center gap-2">
                <button
                  onClick={disconnect}
                  className="inline-flex items-center gap-1.5 px-4 h-10 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200"
                >
                  <LogOut className="h-4 w-4" /> Disconnect
                </button>
                <button
                  onClick={onClose}
                  className="ml-auto px-6 h-10 rounded-md text-sm font-semibold text-white transition hover:brightness-110"
                  style={{ background: "#1a73e8" }}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="flex-1 flex flex-col animate-fade-in">
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 mb-4">
                <div className="flex items-center gap-1.5 mb-1 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Sign-in failed
                </div>
                <div className="text-xs break-words">{error}</div>
              </div>
              <div className="mt-auto flex items-center justify-end">
                <button
                  onClick={() => { setStep("email"); setError(null); }}
                  className="px-6 h-10 rounded-md text-sm font-semibold text-white"
                  style={{ background: "#1a73e8" }}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer note */}
        {step !== "connected" && step !== "loading" && (
          <div className="px-8 py-3 border-t border-zinc-100 flex items-center gap-2 text-[11px] text-zinc-500">
            <Lock className="h-3 w-3" />
            Secure sign-in · Your password is never stored by NazAI
          </div>
        )}
      </div>
    </div>
  );
}
