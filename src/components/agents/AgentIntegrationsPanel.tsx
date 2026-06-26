// Business Integrations & Setup — shown on every generated agent so the
// operator knows exactly which of THEIR real business systems the agent can
// plug into, how to connect them, what it will automate, and the safety rails.
import { useMemo, useState, useEffect } from "react";
import { Plug, KeyRound, Webhook, ShieldCheck, ListChecks, Sparkles, Lock, CheckCircle2 } from "lucide-react";
import IntegrationConnectModal from "./IntegrationConnectModal";

type Integration = {
  name: string;
  category: string;        // CRM, Payments, Email, Analytics, Commerce, Accounting, Bank, Support, Social
  method: string;
  scopes?: string;         // suggested permission scope (read-only / read-write)
  examples: string[];      // what the agent will do once connected
  steps: string[];         // step-by-step user-facing setup
  status?: "recommended" | "optional";
};

export type IntegrationsSpec = {
  summary?: string;
  integrations: Integration[];
  security?: string[];
};

const ROLE_DEFAULTS: Record<string, IntegrationsSpec> = {
  sales_ops: {
    summary:
      "Connect your CRM, mailbox and revenue tools so the agent prospects, drafts outreach and updates your pipeline against real customer data.",
    integrations: [
      { name: "HubSpot", category: "CRM", method: "OAuth", scopes: "contacts.read/write, deals.read/write", status: "recommended",
        examples: ["Create/update contacts from research", "Log activities and move deals through stages", "Score leads against your ICP"],
        steps: ["Click Connect → sign in to HubSpot", "Pick the workspace", "Grant contact + deal scopes", "Map your pipeline stages in the agent's Memory"] },
      { name: "Salesforce", category: "CRM", method: "OAuth", scopes: "api, refresh_token", status: "optional",
        examples: ["Sync accounts and opportunities", "Run SOQL reports on demand"],
        steps: ["Create a Connected App", "Paste consumer key/secret", "Authorize with your sandbox first"] },
      { name: "Gmail / Outlook", category: "Email", method: "OAuth", scopes: "send + read drafts", status: "recommended",
        examples: ["Draft personalised outbound (queued for approval)", "Auto-follow-up after N days of no reply"],
        steps: ["Click Connect → choose mailbox", "Approve the 'drafts' scope only", "Pick the sender alias the agent should use"] },
      { name: "Apollo / Clearbit", category: "Data", method: "API key", status: "optional",
        examples: ["Enrich a domain into firmographics", "Find verified emails for new prospects"],
        steps: ["Generate an API key", "Save it via Lovable Secrets", "Set monthly enrichment cap"] },
      { name: "Slack", category: "Notifications", method: "OAuth", status: "recommended",
        examples: ["Ping #revenue when a hot lead replies", "Daily pipeline digest at 9am"],
        steps: ["Connect Slack workspace", "Choose the channel", "Pick alert severity threshold"] },
    ],
    security: [
      "Outbound emails always require one-click approval before sending.",
      "Discounts above your stated ceiling are blocked and escalated.",
      "Tokens are stored encrypted; the agent only requests minimum scopes.",
    ],
  },
  support: {
    summary:
      "Plug the agent into your real inbox/helpdesk so it triages tickets, drafts brand-tone replies and escalates the right things.",
    integrations: [
      { name: "Zendesk / Intercom / Help Scout", category: "Support", method: "OAuth + Webhook", scopes: "tickets.read/write", status: "recommended",
        examples: ["Triage and tag new tickets by urgency", "Draft replies in your brand tone (queued for approval)", "Auto-escalate refund/legal/churn mentions"],
        steps: ["Click Connect → sign in", "Authorize ticket scopes", "Subscribe webhook to 'ticket.created' & 'ticket.updated'", "Confirm escalation channel"] },
      { name: "Gmail / Outlook (shared inbox)", category: "Email", method: "OAuth", status: "recommended",
        examples: ["Read hello@ inbox and triage", "Draft replies into the user's drafts folder"],
        steps: ["Connect the shared mailbox", "Grant read + drafts (no send)", "Set business hours so urgency is computed correctly"] },
      { name: "Slack / Teams", category: "Notifications", method: "OAuth", status: "recommended",
        examples: ["Page on-call for P1 tickets", "Post daily SLA report"],
        steps: ["Connect workspace", "Pick on-call channel", "Set quiet hours"] },
      { name: "Stripe", category: "Payments", method: "API key", scopes: "read-only", status: "optional",
        examples: ["Auto-attach customer plan & lifetime value to each ticket", "Detect failed-payment tickets"],
        steps: ["Create a restricted key (read-only)", "Save via Lovable Secrets"] },
    ],
    security: [
      "Replies are drafted, never sent, until you approve.",
      "PII is redacted in logs by default.",
      "Refund and legal keywords always escalate, never auto-resolve.",
    ],
  },
  marketing: {
    summary:
      "Connect your CMS, social and analytics so the agent ships content, tracks mentions, and reports on real growth — not vanity numbers.",
    integrations: [
      { name: "WordPress / Webflow / Ghost", category: "CMS", method: "API key", status: "recommended",
        examples: ["Schedule blog drafts", "Update meta tags + OG images", "Auto-rewrite thin pages"],
        steps: ["Create a CMS API token", "Save via Lovable Secrets", "Choose default author + category"] },
      { name: "X / LinkedIn / Instagram", category: "Social", method: "OAuth", status: "recommended",
        examples: ["Draft platform-specific posts", "Schedule a weekly cadence (queued for approval)"],
        steps: ["Connect each account", "Pick posting windows", "Set forbidden-topics list"] },
      { name: "Google Analytics 4", category: "Analytics", method: "OAuth", scopes: "read-only", status: "recommended",
        examples: ["Weekly traffic + conversion brief", "Detect ranking drops and propose fixes"],
        steps: ["Connect the GA4 property", "Grant Viewer role", "Pick the primary conversion event"] },
      { name: "Google Search Console / Semrush", category: "SEO", method: "OAuth / API key", status: "optional",
        examples: ["Monitor keyword positions", "Flag pages losing impressions"],
        steps: ["Verify property ownership", "Connect", "Set tracked keyword list"] },
      { name: "Slack", category: "Notifications", method: "OAuth", status: "optional",
        examples: ["Mention alerts in real time", "Weekly brief in #marketing"],
        steps: ["Connect workspace", "Pick channel"] },
    ],
    security: [
      "Nothing is published publicly without your approval.",
      "Brand tone + forbidden-topics list are enforced before every draft.",
      "Analytics scopes are read-only.",
    ],
  },
  ops_finance: {
    summary:
      "Wire the agent into your books, payments and bank feeds so it computes real KPIs, surfaces anomalies and chases overdue invoices.",
    integrations: [
      { name: "Stripe", category: "Payments", method: "API key + Webhook", scopes: "read-only key + events webhook", status: "recommended",
        examples: ["Daily MRR / churn / failed-payment digest", "Anomaly alerts on refund spikes"],
        steps: ["Create restricted (read-only) key", "Save via Lovable Secrets", "Add webhook endpoint for charge.failed & invoice.*"] },
      { name: "QuickBooks / Xero", category: "Accounting", method: "OAuth", scopes: "accounting.read", status: "recommended",
        examples: ["Nudge overdue invoices (draft + approve)", "Monthly P&L snapshot"],
        steps: ["Connect the company file", "Authorize read scope", "Set overdue-day threshold"] },
      { name: "Bank feed (Plaid / Truelayer)", category: "Bank", method: "OAuth", scopes: "transactions.read", status: "optional",
        examples: ["Reconcile incoming payments", "Cash-runway alert when below N months"],
        steps: ["Connect institution via Plaid Link", "Pick the operating account", "Set runway threshold"] },
      { name: "Shopify / WooCommerce", category: "Commerce", method: "OAuth / API key", status: "optional",
        examples: ["Daily orders + AOV + refund-rate report", "Low-stock alerts"],
        steps: ["Install the connector / paste consumer key+secret", "Pick the store", "Set low-stock threshold"] },
      { name: "Slack / Email", category: "Notifications", method: "OAuth", status: "recommended",
        examples: ["Anomaly alerts", "Weekly KPI digest"],
        steps: ["Connect", "Pick channel/inbox"] },
    ],
    security: [
      "All financial keys are read-only by default. Write scopes require explicit upgrade.",
      "No funds move and no customers are charged without your approval.",
      "Anomalies > 25% are flagged, not auto-actioned.",
    ],
  },
  custom: {
    summary:
      "The agent can connect to any of your business systems. Start with the essentials below; add more later as the agent learns your workflow.",
    integrations: [
      { name: "Email (Gmail / Outlook)", category: "Email", method: "OAuth", status: "recommended",
        examples: ["Read & draft messages", "Send digests"],
        steps: ["Connect mailbox", "Approve scopes", "Pick sender alias"] },
      { name: "CRM (HubSpot / Salesforce / Pipedrive)", category: "CRM", method: "OAuth", status: "optional",
        examples: ["Sync contacts and deals"],
        steps: ["Connect workspace", "Authorize scopes"] },
      { name: "Payments (Stripe)", category: "Payments", method: "API key", status: "optional",
        examples: ["Revenue + churn KPIs"],
        steps: ["Generate restricted key", "Save via Lovable Secrets"] },
      { name: "Analytics (GA4)", category: "Analytics", method: "OAuth", status: "optional",
        examples: ["Traffic + conversion reports"],
        steps: ["Connect property", "Grant Viewer"] },
      { name: "Slack", category: "Notifications", method: "OAuth", status: "recommended",
        examples: ["Notifications + digests"],
        steps: ["Connect workspace", "Pick channel"] },
    ],
    security: [
      "External actions are always queued for one-click approval.",
      "Tokens stored encrypted; minimum-required scopes.",
      "The agent will ask before broadening permissions.",
    ],
  },
};

function pickRoleFromManifest(manifest: { goal?: string; name?: string }): keyof typeof ROLE_DEFAULTS {
  const p = `${manifest?.name || ""} ${manifest?.goal || ""}`.toLowerCase();
  if (/support|ticket|inbox|helpdesk/.test(p)) return "support";
  if (/sales|lead|prospect|outreach|crm|pipeline/.test(p)) return "sales_ops";
  if (/market|content|seo|social|blog|brand/.test(p)) return "marketing";
  if (/finance|invoice|kpi|revenue|ops|operations|report/.test(p)) return "ops_finance";
  return "custom";
}

export default function AgentIntegrationsPanel({
  manifest,
  accent = "#34d399",
}: {
  manifest: { name?: string; goal?: string; integrations?: IntegrationsSpec; role?: string };
  accent?: string;
}) {
  const spec = useMemo<IntegrationsSpec>(() => {
    if (manifest?.integrations?.integrations?.length) return manifest.integrations;
    const role = (manifest as { role?: string })?.role && manifest.role! in ROLE_DEFAULTS
      ? (manifest.role as keyof typeof ROLE_DEFAULTS)
      : pickRoleFromManifest(manifest);
    return ROLE_DEFAULTS[role];
  }, [manifest]);

  const [openIntegration, setOpenIntegration] = useState<Integration | null>(null);
  const [connectedNames, setConnectedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refresh = () => {
      const s = new Set<string>();
      for (const it of spec.integrations) {
        if (localStorage.getItem(`nazai:integration:${it.name}`)) s.add(it.name);
      }
      setConnectedNames(s);
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [spec.integrations, openIntegration]);

  return (
    <section
      className="relative overflow-hidden rounded-3xl p-5 sm:p-6 mt-4"
      style={{
        background: `linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), radial-gradient(120% 80% at 100% 0%, ${accent}1f, transparent 60%), #08090c`,
        border: `1px solid ${accent}33`,
        boxShadow: `0 30px 80px -50px ${accent}66`,
      }}
    >
      <header className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 8px 24px -8px ${accent}99` }}>
          <Plug className="h-5 w-5 text-black" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.24em] font-mono text-zinc-400">Business Integrations &amp; Setup</div>
          <h3 className="text-lg sm:text-xl font-bold text-white">Connect this agent to your real business systems</h3>
          {spec.summary && <p className="text-[13px] text-zinc-400 mt-1 leading-relaxed">{spec.summary}</p>}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {spec.integrations.map((it) => {
          const isConnected = connectedNames.has(it.name);
          return (
          <button
            type="button"
            key={it.name}
            onClick={() => setOpenIntegration(it)}
            className="text-left rounded-2xl border border-white/10 bg-white/[0.02] p-4 hover:border-white/30 hover:bg-white/[0.04] transition-all hover:-translate-y-0.5 cursor-pointer">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-sm font-semibold text-white truncate">{it.name}</div>
                  {isConnected && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}>
                      <CheckCircle2 className="h-2.5 w-2.5" /> Connected
                    </span>
                  )}
                  {!isConnected && it.status === "recommended" && (
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-white truncate">{it.name}</div>
                  {it.status === "recommended" && (
                    <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}>
                      Recommended
                    </span>
                  )}
                </div>
                <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mt-0.5">{it.category}</div>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-white/10 bg-black/30 text-zinc-300 shrink-0">
                {it.method.includes("OAuth") ? <KeyRound className="h-3 w-3" /> :
                 it.method.includes("Webhook") ? <Webhook className="h-3 w-3" /> :
                 <Lock className="h-3 w-3" />}
                {it.method}
              </span>
            </div>
            {it.scopes && (
              <div className="text-[10px] text-zinc-500 font-mono mb-2">scopes: {it.scopes}</div>
            )}
            <div className="mb-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono text-zinc-400 mb-1">
                <Sparkles className="h-3 w-3" style={{ color: accent }} /> What it automates
              </div>
              <ul className="space-y-0.5 pl-1">
                {it.examples.map((e, i) => <li key={i} className="text-xs text-zinc-300">• {e}</li>)}
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono text-zinc-400 mb-1">
                <ListChecks className="h-3 w-3" style={{ color: accent }} /> Setup
              </div>
              <ol className="space-y-0.5 pl-1">
                {it.steps.map((s, i) => (
                  <li key={i} className="text-xs text-zinc-300">
                    <span className="text-zinc-500 font-mono mr-1">{i + 1}.</span>{s}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ))}
      </div>

      {spec.security && spec.security.length > 0 && (
        <div className="mt-4 rounded-2xl border p-4"
          style={{ borderColor: `${accent}33`, background: `${accent}0d` }}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="h-4 w-4" style={{ color: accent }} />
            <div className="text-[11px] uppercase tracking-[0.24em] font-mono font-semibold" style={{ color: accent }}>
              Security &amp; guardrails
            </div>
          </div>
          <ul className="space-y-1">
            {spec.security.map((s, i) => <li key={i} className="text-xs text-zinc-300">• {s}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
