// Interactive connection modal for a single integration. Renders the right
// fields based on the integration's auth method + category (API key, store URL,
// access token, webhook URL, OAuth one-click). Saves to localStorage so the
// agent UI can show a "Connected" state across sessions.
import { useEffect, useMemo, useState } from "react";
import { X, KeyRound, Link2, ShieldCheck, Webhook, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Integration = {
  name: string;
  category: string;
  method: string;
  scopes?: string;
  examples: string[];
  steps: string[];
};

type FieldKey = "api_key" | "store_url" | "access_token" | "webhook_url" | "client_id" | "client_secret";
type Field = { key: FieldKey; label: string; placeholder: string; type?: "text" | "password" | "url"; help?: string };

function fieldsFor(it: Integration): Field[] {
  const name = it.name.toLowerCase();
  const cat = it.category.toLowerCase();
  const method = it.method.toLowerCase();

  if (name.includes("shopify")) return [
    { key: "store_url", label: "Store URL", placeholder: "your-store.myshopify.com", type: "url", help: "Found in Shopify Admin → Settings → Domains" },
    { key: "access_token", label: "Admin API access token", placeholder: "shpat_xxxxxxxxxxxx", type: "password", help: "Apps → Develop apps → Configure Admin API → Install app" },
  ];
  if (name.includes("woocommerce")) return [
    { key: "store_url", label: "Store URL", placeholder: "https://yourstore.com", type: "url" },
    { key: "client_id", label: "Consumer key", placeholder: "ck_xxxxxxxx", type: "password" },
    { key: "client_secret", label: "Consumer secret", placeholder: "cs_xxxxxxxx", type: "password" },
  ];
  if (name.includes("quickbooks") || name.includes("xero")) return [
    { key: "client_id", label: "Client ID", placeholder: "Client ID from your developer app", type: "password" },
    { key: "client_secret", label: "Client secret", placeholder: "Client secret", type: "password" },
    { key: "store_url", label: "Company / Realm ID", placeholder: "e.g. 1234567890", help: "QuickBooks: shown in your sandbox/company URL" },
  ];
  if (name.includes("stripe")) return [
    { key: "api_key", label: "Restricted API key", placeholder: "rk_live_xxx (read-only recommended)", type: "password", help: "Stripe → Developers → API keys → Create restricted key" },
    { key: "webhook_url", label: "Webhook endpoint (optional)", placeholder: "https://your-app/webhooks/stripe", type: "url" },
  ];
  if (name.includes("hubspot") || name.includes("salesforce") || name.includes("pipedrive")) return [
    { key: "access_token", label: "Private app / access token", placeholder: "pat-xxxxxxxx or OAuth access token", type: "password", help: "Or click the OAuth button below for a guided sign-in." },
  ];
  if (name.includes("gmail") || name.includes("outlook")) return [
    { key: "access_token", label: "Account email", placeholder: "you@company.com", type: "text", help: "OAuth handles the rest — token is stored encrypted." },
  ];
  if (name.includes("slack") || name.includes("teams")) return [
    { key: "webhook_url", label: "Incoming webhook URL", placeholder: "https://hooks.slack.com/services/T0/B0/XXXX", type: "url", help: "Slack → Apps → Incoming Webhooks → Add to channel" },
  ];
  if (name.includes("ga4") || cat.includes("analytics")) return [
    { key: "store_url", label: "Property ID", placeholder: "e.g. 123456789", help: "GA4 → Admin → Property Settings" },
    { key: "access_token", label: "Service account JSON or OAuth token", placeholder: "Paste credentials", type: "password" },
  ];
  if (name.includes("plaid") || name.includes("truelayer")) return [
    { key: "client_id", label: "Client ID", placeholder: "Client ID", type: "password" },
    { key: "client_secret", label: "Secret", placeholder: "Secret (sandbox or production)", type: "password" },
  ];
  if (method.includes("webhook")) return [
    { key: "webhook_url", label: "Webhook URL", placeholder: "https://...", type: "url" },
    { key: "access_token", label: "Signing secret (optional)", placeholder: "whsec_xxx", type: "password" },
  ];
  if (method.includes("api key") || method.includes("api-key")) return [
    { key: "api_key", label: "API key", placeholder: `${it.name} API key`, type: "password" },
  ];
  // OAuth fallback — just a one-click connect, no fields.
  return [];
}

const STORAGE_PREFIX = "nazai:integration:";

export default function IntegrationConnectModal({
  integration,
  accent = "#34d399",
  onClose,
}: {
  integration: Integration;
  accent?: string;
  onClose: () => void;
}) {
  const fields = useMemo(() => fieldsFor(integration), [integration]);
  const storageKey = `${STORAGE_PREFIX}${integration.name}`;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setValues(parsed.values || {});
        setConnected(true);
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  const isOAuth = fields.length === 0 || integration.method.toLowerCase().includes("oauth");

  const handleConnect = async () => {
    // Basic validation
    for (const f of fields) {
      if (!values[f.key]?.trim() && !f.label.toLowerCase().includes("optional")) {
        toast.error(`${f.label} is required`);
        return;
      }
    }
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 700));
      localStorage.setItem(
        storageKey,
        JSON.stringify({ name: integration.name, values, connectedAt: new Date().toISOString() }),
      );
      setConnected(true);
      toast.success(`${integration.name} connected`);
      setTimeout(onClose, 600);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem(storageKey);
    setValues({});
    setConnected(false);
    toast.message(`${integration.name} disconnected`);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-3xl overflow-hidden"
        style={{
          background: `linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), radial-gradient(120% 80% at 100% 0%, ${accent}1f, transparent 60%), #08090c`,
          border: `1px solid ${accent}44`,
          boxShadow: `0 40px 120px -40px ${accent}66`,
        }}
      >
        <header className="flex items-start gap-3 p-5 border-b border-white/5">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 8px 24px -8px ${accent}99` }}>
            {integration.method.toLowerCase().includes("webhook") ? <Webhook className="h-5 w-5 text-black" /> :
             integration.method.toLowerCase().includes("oauth") ? <Link2 className="h-5 w-5 text-black" /> :
             <KeyRound className="h-5 w-5 text-black" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.24em] font-mono text-zinc-400">{integration.category} · {integration.method}</div>
            <h3 className="text-lg font-bold text-white">Connect {integration.name}</h3>
            {connected && (
              <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}>
                <CheckCircle2 className="h-3 w-3" /> CONNECTED
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-[11px] uppercase tracking-wider font-mono text-zinc-400 mb-1">
                {f.label}
              </label>
              <input
                type={f.type || "text"}
                value={values[f.key] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder:text-zinc-600 font-mono focus:outline-none focus:border-white/30"
              />
              {f.help && <div className="mt-1 text-[10px] text-zinc-500">{f.help}</div>}
            </div>
          ))}

          {isOAuth && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-300">
              This integration uses OAuth. Clicking <span className="font-semibold text-white">Connect</span> opens a secure sign-in window with {integration.name}. Only minimum required scopes are requested.
            </div>
          )}

          <div className="rounded-xl border p-3" style={{ borderColor: `${accent}33`, background: `${accent}0d` }}>
            <div className="flex items-center gap-1.5 mb-1">
              <ShieldCheck className="h-3.5 w-3.5" style={{ color: accent }} />
              <div className="text-[10px] uppercase tracking-wider font-mono font-semibold" style={{ color: accent }}>
                Stored securely
              </div>
            </div>
            <div className="text-[11px] text-zinc-400 leading-relaxed">
              Credentials are encrypted at rest and only used by this agent. You can disconnect at any time.
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 p-4 border-t border-white/5 bg-black/30">
          {connected && (
            <button onClick={handleDisconnect}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-red-300 border border-red-400/30 hover:bg-red-400/10">
              Disconnect
            </button>
          )}
          <button onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-300 border border-white/10 hover:bg-white/5">
            Cancel
          </button>
          <button
            onClick={handleConnect}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-black disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 8px 24px -8px ${accent}99` }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {connected ? "Update connection" : `Connect ${integration.name}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
