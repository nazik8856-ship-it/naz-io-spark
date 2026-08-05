// ============================================================================
// CAPABILITY REGISTRY — single source of truth for what NazAI agents can
// GENUINELY do today.
//
// Every tool kind the agent engine knows about is declared here and classified
// honestly against what the code actually does right now:
//
//   implemented : there is a real executor that performs the action for real
//                 (a real external API call, or a real persisted write).
//                 `false` = stub / inert / internal-only logging.
//   verified    : after acting, the executor confirms the effect really
//                 happened (re-fetch / read-back / provider-returned receipt)
//                 before reporting ok:true. `false` = fire-and-forget.
//   provider    : the external account that must be CONNECTED for this tool to
//                 work at all. `null` = internal, no connection needed.
//
// This file intentionally does NOT change any tool behaviour. It only decides
// which tools are OFFERED to the model, and gives the model exact, honest
// language for the things it cannot actually do yet.
// ============================================================================

export type Capability = {
  /** Tool kind as dispatched inside agent-runtime. */
  kind: string;
  /** Provider account required, or null for internal tools. */
  provider: string | null;
  /** Other integration names that satisfy `provider` (granular Google conns). */
  providerAliases?: string[];
  implemented: boolean;
  verified: boolean;
  /** read = only reads data; write = causes an external/persistent effect. */
  mode: "read" | "write" | "internal";
  /** How the effect is confirmed — shown in the registry, empty when unverified. */
  verification: string;
  /** Plain-language statement of what is / isn't real, used in agent output. */
  honesty: string;
};

export const CAPABILITY_REGISTRY: Record<string, Capability> = {
  // ---------- Internal engine tools (no external account needed) ----------
  web_search: {
    kind: "web_search", provider: null, implemented: true, verified: true, mode: "read",
    verification: "returns the actual search results fetched live",
    honesty: "I can search the web for real.",
  },
  http_get: {
    kind: "http_get", provider: null, implemented: true, verified: true, mode: "read",
    verification: "returns the real HTTP status and response body",
    honesty: "I can fetch any public URL for real.",
  },
  http_post: {
    kind: "http_post", provider: null, implemented: true, verified: true, mode: "write",
    verification: "confirmed by the endpoint's real HTTP status + response body",
    honesty: "I can POST to allow-listed webhooks and report the endpoint's real response.",
  },
  calc: {
    kind: "calc", provider: null, implemented: true, verified: true, mode: "internal",
    verification: "deterministic evaluation",
    honesty: "I can compute expressions.",
  },
  remember: {
    kind: "remember", provider: null, implemented: true, verified: true, mode: "internal",
    verification: "row persisted in agent_memory",
    honesty: "I can persist facts for future runs.",
  },
  ask_user: {
    kind: "ask_user", provider: null, implemented: true, verified: true, mode: "internal",
    verification: "run pauses until the operator actually answers",
    honesty: "I can ask you a question and wait for your answer.",
  },
  request_approval: {
    kind: "request_approval", provider: null, implemented: true, verified: true, mode: "internal",
    verification: "approval row persisted and surfaced in the UI",
    honesty: "I can queue an action for your approval.",
  },
  deep_analyze: {
    kind: "deep_analyze", provider: null, implemented: true, verified: true, mode: "internal",
    verification: "returns the model's structured diagnosis",
    honesty: "I can run deep analysis with a stronger model.",
  },
  audit_url: {
    kind: "audit_url", provider: null, implemented: true, verified: true, mode: "read",
    verification: "page is really fetched before auditing",
    honesty: "I can fetch and audit a real page.",
  },
  make_plan: {
    kind: "make_plan", provider: null, implemented: true, verified: true, mode: "internal",
    verification: "returns the produced plan",
    honesty: "I can produce an execution plan.",
  },
  generate_report: {
    kind: "generate_report", provider: null, implemented: true, verified: true, mode: "write",
    verification: "row written to agent_reports and its id returned",
    honesty: "I can save a durable report inside NazAI (not published anywhere external).",
  },
  upsert_client_note: {
    kind: "upsert_client_note", provider: null, implemented: true, verified: true, mode: "write",
    verification: "client row read back with its id",
    honesty: "I can create/update client records inside NazAI (not in an external CRM).",
  },
  schedule_followup: {
    kind: "schedule_followup", provider: null, implemented: true, verified: true, mode: "write",
    verification: "scheduled run row created and its id returned",
    honesty: "I can schedule myself to run again.",
  },
  sync_integrations: {
    kind: "sync_integrations", provider: null, implemented: true, verified: true, mode: "read",
    verification: "snapshots re-read after the sync",
    honesty: "I can refresh live data from your connected tools.",
  },
  integration_query: {
    kind: "integration_query", provider: null, implemented: true, verified: true, mode: "read",
    verification: "returns the actual stored snapshot",
    honesty: "I can read the latest synced snapshot of a connected tool.",
  },

  // ---------- Internal-only: NOT a real external delivery ----------
  notify: {
    kind: "notify", provider: null, implemented: false, verified: false, mode: "internal",
    verification: "",
    honesty:
      "notify does NOT send anything to anyone — it only writes a line into this run's internal log. Never describe it as a message, alert, ping or notification that was delivered. To actually reach a human, use send_email (Gmail) or say plainly that you cannot deliver it.",
  },
  custom: {
    kind: "custom", provider: null, implemented: false, verified: false, mode: "internal",
    verification: "",
    honesty: "Custom manifest tools have no executor wired — they do nothing.",
  },

  // ---------- Google (real API calls, all read-back verified) ----------
  send_email: {
    kind: "send_email", provider: "Gmail", implemented: true, verified: true, mode: "write",
    verification: "sent message re-fetched from Gmail by id",
    honesty: "I can really send email from your Gmail account.",
  },
  reply_email: {
    kind: "reply_email", provider: "Gmail", implemented: true, verified: true, mode: "write",
    verification: "sent reply re-fetched from Gmail by id",
    honesty: "I can really reply inside a Gmail thread.",
  },
  read_email: {
    kind: "read_email", provider: "Gmail", implemented: true, verified: true, mode: "read",
    verification: "content returned is what Gmail actually returned",
    honesty: "I can read your Gmail messages (metadata scope + send).",
  },
  create_doc: {
    kind: "create_doc", provider: "Google Docs", providerAliases: ["Google Drive", "Gmail"],
    implemented: true, verified: true, mode: "write",
    verification: "document re-fetched via the Docs API after creation",
    honesty: "I can really create Google Docs.",
  },
  edit_doc: {
    kind: "edit_doc", provider: "Google Docs", providerAliases: ["Google Drive", "Gmail"],
    implemented: true, verified: true, mode: "write",
    verification: "document re-read after the edit",
    honesty: "I can really edit an existing Google Doc.",
  },
  create_sheet: {
    kind: "create_sheet", provider: "Google Sheets", providerAliases: ["Google Drive", "Gmail"],
    implemented: true, verified: true, mode: "write",
    verification: "spreadsheet re-fetched after creation",
    honesty: "I can really create Google Sheets.",
  },
  edit_sheet: {
    kind: "edit_sheet", provider: "Google Sheets", providerAliases: ["Google Drive", "Gmail"],
    implemented: true, verified: true, mode: "write",
    verification: "range re-read after the update",
    honesty: "I can really update a range in an existing Google Sheet.",
  },
  create_calendar_event: {
    kind: "create_calendar_event", provider: "Google Calendar", providerAliases: ["Gmail"],
    implemented: true, verified: true, mode: "write",
    verification: "event re-fetched and checked it isn't cancelled",
    honesty: "I can really create Google Calendar events.",
  },
  read_analytics: {
    kind: "read_analytics", provider: "Google Analytics", providerAliases: ["Gmail"],
    implemented: true, verified: true, mode: "read",
    verification: "numbers come straight from the GA4 Data API",
    honesty: "I can read GA4 traffic numbers.",
  },

  // ---------- Connected but READ-ONLY today: no write executor exists ----------
  slack_post_message: {
    kind: "slack_post_message", provider: "Slack", implemented: true, verified: true, mode: "write",
    verification: "Slack's own chat.postMessage receipt (ok:true + message ts), plus a channel read-back where scopes allow",
    honesty: "I can really post messages to Slack channels.",
  },
  canva_create_design: {
    kind: "canva_create_design", provider: "Canva", implemented: true, verified: true, mode: "write",
    verification: "design fetched back by id from the Canva Connect API",
    honesty: "I can really create Canva designs.",
  },
  canva_list_designs: {
    kind: "canva_list_designs", provider: "Canva", implemented: true, verified: true, mode: "read",
    verification: "returns the designs the Canva Connect API actually returned",
    honesty: "I can list your existing Canva designs for real.",
  },
  canva_create_folder: {
    kind: "canva_create_folder", provider: "Canva", implemented: true, verified: true, mode: "write",
    verification: "folder fetched back by id from the Canva Connect API",
    honesty: "I can really create Canva folders (projects) and put new designs inside them.",
  },
  notion_create_page: {
    kind: "notion_create_page", provider: "Notion", implemented: true, verified: true, mode: "write",
    verification: "page re-fetched from the Notion API after creation",
    honesty: "I can really create Notion pages.",
  },
  notion_update_page: {
    kind: "notion_update_page", provider: "Notion", implemented: true, verified: true, mode: "write",
    verification: "page re-fetched after the update and the changed state checked",
    honesty: "I can really update Notion pages.",
  },
  shopify_create_draft_order: {
    kind: "shopify_create_draft_order", provider: "Shopify", implemented: true, verified: true, mode: "write",
    verification: "draft order re-fetched by id from the Shopify Admin API",
    honesty: "I can really create Shopify draft orders.",
  },
  shopify_update_product: {
    kind: "shopify_update_product", provider: "Shopify", implemented: true, verified: true, mode: "write",
    verification: "product re-fetched and every changed field compared against what was requested",
    honesty: "I can really update Shopify products, including variant prices.",
  },
  figma_post_comment: {
    kind: "figma_post_comment", provider: "Figma", implemented: true, verified: true, mode: "write",
    verification: "the file's comments are re-fetched and the new comment id found",
    honesty: "I can really post comments on Figma files (and pin them to a node). Figma's API can't create files or draw designs — for real design creation use Canva.",
  },
  figma_create_dev_resource: {
    kind: "figma_create_dev_resource", provider: "Figma", implemented: true, verified: true, mode: "write",
    verification: "the node's dev resources are re-fetched and the new link found",
    honesty: "I can really attach dev resource links to Figma nodes. I can't create or edit the design itself — for real design creation use Canva.",
  },
};

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when the org has an active connection satisfying this capability. */
export function providerConnected(cap: Capability, connected: string[]): boolean {
  if (!cap.provider) return true;
  const have = new Set(connected.map(norm));
  const want = [cap.provider, ...(cap.providerAliases || [])].map(norm);
  return want.some((w) => have.has(w));
}

export type Offerability =
  | { offerable: true }
  | { offerable: false; reason: "not_implemented" | "unverified" | "provider_not_connected"; message: string };

/**
 * Tool selection gate: a tool is only offered when it is implemented AND
 * verified AND its provider is actually connected for this org.
 */
export function canOfferTool(kind: string, connected: string[]): Offerability {
  const cap = CAPABILITY_REGISTRY[kind];
  // Unknown kinds are treated as unimplemented rather than silently allowed.
  if (!cap) {
    return { offerable: false, reason: "not_implemented", message: `"${kind}" has no real implementation in NazAI yet.` };
  }
  if (!cap.implemented) return { offerable: false, reason: "not_implemented", message: cap.honesty };
  if (!cap.verified) {
    return {
      offerable: false,
      reason: "unverified",
      message: `${kind} exists but cannot confirm its effect actually happened, so it is not offered.`,
    };
  }
  if (!providerConnected(cap, connected)) {
    return {
      offerable: false,
      reason: "provider_not_connected",
      message: `${kind} needs a connected ${cap.provider} account, and none is connected.`,
    };
  }
  return { offerable: true };
}

/**
 * Prompt block telling the model exactly what is real, what is internal-only,
 * and what it must refuse honestly instead of faking.
 */
export function buildCapabilityBlock(connected: string[]): string {
  const caps = Object.values(CAPABILITY_REGISTRY);
  const real = caps.filter((c) => c.implemented && c.verified && providerConnected(c, connected));
  const needsConnection = caps.filter((c) => c.implemented && c.verified && !providerConnected(c, connected));
  const notReal = caps.filter((c) => !c.implemented || !c.verified);

  const line = (c: Capability) => `- ${c.kind}${c.provider ? ` [${c.provider}]` : ""}: ${c.honesty}`;

  return `
# Capability registry — what is REAL right now (single source of truth)
You must never claim, imply or summarise an outcome that did not really happen.

## Genuinely available to you this run (real API calls, effect verified afterwards)
${real.map(line).join("\n") || "- (none)"}

## Real implementations that are UNAVAILABLE because the account isn't connected
${needsConnection.map((c) => `- ${c.kind} — needs a connected ${c.provider}. Say so and offer to have the operator connect it; do not attempt it.`).join("\n") || "- (none)"}

## NOT implemented — you CANNOT do these, say so plainly
${notReal.map(line).join("\n")}

## Honesty contract
- If the requested action is in the "NOT implemented" or "unavailable" lists, state it directly in your output, e.g. "I can read Slack but can't post messages yet" or "I can't create Canva designs yet."
- Never substitute notify (or any internal log) for a real delivery and never describe it as if a person received something.
- Offer the closest real alternative (e.g. draft the text and send it by email, or save it as a report) and be explicit that it is an alternative.
- In your finish summary, only list under "Delivered:" the things a verified real tool actually produced.`;
}
