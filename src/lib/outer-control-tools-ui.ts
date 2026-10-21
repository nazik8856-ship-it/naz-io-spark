// Outer Control: the plain wording and small decisions behind "Connected tools", the "Connect a tool" panel and the
// live activity of a session. Pure, so the components stay layout and these rules are tested alone.
import { NEXT_ACTION_LABEL, type CompletionView, type DecisionView, type PendingKind, type SessionStatus } from "./outer-control-sessions";

// ---------------------------------------------------------------------------------------
// Tool status: Working / Failed / Needs attention, each with its reason

export type ToolHealthKey = "working" | "failed" | "attention";
export type ToolHealth = { key: ToolHealthKey; label: string; reason: string };
export type ToolHealthInput = { approved_at: string | null; last_ok_at: string | null; last_checked_at: string | null; last_error: string | null };

/** A good test older than this no longer proves the tool works today. */
export const TEST_STALE_MS = 24 * 60 * 60 * 1000;

export function ago(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/**
 * One status per tool. Failed: the last test failed. Working: the last test succeeded, recently, and nothing is waiting on
 * the person. Needs attention: it was never tested, the good test is old, or the first contact still needs approval.
 */
export function toolHealth(t: ToolHealthInput, now = Date.now()): ToolHealth {
  if (t.last_checked_at && t.last_error) return { key: "failed", label: "Failed", reason: t.last_error };
  if (!t.last_checked_at || !t.last_ok_at) return { key: "attention", label: "Needs attention", reason: "Not tested yet. Press Test to check the connection." };
  if (now - Date.parse(t.last_ok_at) > TEST_STALE_MS) return { key: "attention", label: "Needs attention", reason: `Last tested ${ago(t.last_ok_at, now)}. Press Test to check it again.` };
  if (!t.approved_at) return { key: "attention", label: "Needs attention", reason: "The first session asks you to approve contacting this tool." };
  return { key: "working", label: "Working", reason: `Test passed ${ago(t.last_ok_at, now)}.` };
}

export function healthSummary(tools: ToolHealthInput[], now = Date.now()): string {
  if (tools.length === 0) return "No tools connected";
  const c = { working: 0, failed: 0, attention: 0 };
  for (const t of tools) c[toolHealth(t, now).key]++;
  const parts = [`${tools.length} tool${tools.length === 1 ? "" : "s"}`];
  if (c.working) parts.push(`${c.working} working`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.attention) parts.push(`${c.attention} need${c.attention === 1 ? "s" : ""} attention`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------
// Featured tools and the custom connector

export type Featured = {
  id: string; name: string; blurb: string; endpoint_url: string; request_format: "openai_chat" | "anthropic_messages" | "generic_json";
  model: string; auth_header: string; auth_scheme: string; keyLabel: string; keysAt: string;
  /** What to do on the provider's key page (step 2 of "Get your key"). */
  keyStep: string;
  /** Extra words the search matches (the company, the product, what it is known for). */
  keywords: string;
  /** The short mark on the connector tile (shown if the logo can not be loaded). */
  mark: string;
  /** The service's logo, in public/connectors. */
  icon: string;
};

/** Model names change; each is a starting value the person can edit. The connection test is what proves the choice works. */
export const FEATURED_TOOLS: Featured[] = [
  { id: "openai", mark: "GPT", icon: "/connectors/openai.svg", name: "ChatGPT (OpenAI)", blurb: "OpenAI chat models through the OpenAI API.", endpoint_url: "https://api.openai.com/v1/chat/completions", request_format: "openai_chat", model: "gpt-4o", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "OpenAI API key", keysAt: "platform.openai.com/api-keys", keyStep: "Sign in to OpenAI and choose Create new secret key.", keywords: "openai chatgpt gpt" },
  { id: "anthropic", mark: "Cl", icon: "/connectors/anthropic.svg", name: "Claude (Anthropic)", blurb: "Claude models through the Anthropic API.", endpoint_url: "https://api.anthropic.com/v1/messages", request_format: "anthropic_messages", model: "claude-sonnet-5-5", auth_header: "x-api-key", auth_scheme: "", keyLabel: "Anthropic API key", keysAt: "console.anthropic.com/settings/keys", keyStep: "Sign in to the Anthropic Console and choose Create Key.", keywords: "anthropic claude sonnet opus haiku" },
  { id: "gemini", mark: "Ge", icon: "/connectors/gemini.svg", name: "Gemini (Google)", blurb: "Gemini models through Google's OpenAI-compatible endpoint.", endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", request_format: "openai_chat", model: "gemini-2.0-flash", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "Gemini API key", keysAt: "aistudio.google.com/apikey", keyStep: "Sign in with your Google account and choose Create API key.", keywords: "google gemini bard" },
  { id: "grok", mark: "Gk", icon: "/connectors/grok.svg", name: "Grok (xAI)", blurb: "Grok models through the xAI API.", endpoint_url: "https://api.x.ai/v1/chat/completions", request_format: "openai_chat", model: "grok-3", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "xAI API key", keysAt: "console.x.ai", keyStep: "Sign in with your X account and create an API key.", keywords: "xai grok x twitter" },
  { id: "mistral", mark: "Mi", icon: "/connectors/mistral.svg", name: "Mistral AI", blurb: "Mistral models through the Mistral AI API.", endpoint_url: "https://api.mistral.ai/v1/chat/completions", request_format: "openai_chat", model: "mistral-large-latest", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "Mistral API key", keysAt: "console.mistral.ai/api-keys", keyStep: "Sign in to Mistral AI and create an API key.", keywords: "mistral le chat european" },
  { id: "perplexity", mark: "Px", icon: "/connectors/perplexity.svg", name: "Perplexity", blurb: "Search-grounded answers through the Perplexity API.", endpoint_url: "https://api.perplexity.ai/chat/completions", request_format: "openai_chat", model: "sonar", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "Perplexity API key", keysAt: "perplexity.ai/settings/api", keyStep: "Sign in to Perplexity and generate an API key.", keywords: "perplexity sonar search web research" },
  { id: "deepseek", mark: "DS", icon: "/connectors/deepseek.svg", name: "DeepSeek", blurb: "DeepSeek models through the DeepSeek API.", endpoint_url: "https://api.deepseek.com/chat/completions", request_format: "openai_chat", model: "deepseek-chat", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "DeepSeek API key", keysAt: "platform.deepseek.com/api_keys", keyStep: "Sign in to DeepSeek and create an API key.", keywords: "deepseek reasoning" },
  { id: "groq", mark: "Gq", icon: "/connectors/groq.svg", name: "Groq", blurb: "Groq, not Grok: very fast open models such as Llama on Groq's own hardware.", endpoint_url: "https://api.groq.com/openai/v1/chat/completions", request_format: "openai_chat", model: "llama-3.3-70b-versatile", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "Groq API key", keysAt: "console.groq.com/keys", keyStep: "Sign in to GroqCloud and create an API key.", keywords: "groq llama meta fast open" },
  { id: "openrouter", mark: "OR", icon: "/connectors/openrouter.svg", name: "OpenRouter", blurb: "One key for many models from many providers.", endpoint_url: "https://openrouter.ai/api/v1/chat/completions", request_format: "openai_chat", model: "openai/gpt-4o", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "OpenRouter API key", keysAt: "openrouter.ai/keys", keyStep: "Sign in to OpenRouter and create a key.", keywords: "openrouter router many models" },
  { id: "fireworks", mark: "Fw", icon: "/connectors/fireworks.svg", name: "Fireworks AI", blurb: "Open models hosted by Fireworks AI.", endpoint_url: "https://api.fireworks.ai/inference/v1/chat/completions", request_format: "openai_chat", model: "accounts/fireworks/models/llama-v3p3-70b-instruct", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "Fireworks API key", keysAt: "fireworks.ai/account/api-keys", keyStep: "Sign in to Fireworks AI and create an API key.", keywords: "fireworks llama open" },
  { id: "cohere", mark: "Co", icon: "/connectors/cohere.svg", name: "Cohere", blurb: "Command models through Cohere's OpenAI-compatible endpoint.", endpoint_url: "https://api.cohere.ai/compatibility/v1/chat/completions", request_format: "openai_chat", model: "command-r-plus", auth_header: "Authorization", auth_scheme: "Bearer ", keyLabel: "Cohere API key", keysAt: "dashboard.cohere.com/api-keys", keyStep: "Sign in to the Cohere dashboard and create an API key.", keywords: "cohere command enterprise" },
];

/** The connectors that match what the person typed: every word must appear in the name, description or keywords. */
export function searchConnectors<T extends { name: string; blurb?: string; keywords?: string; id?: string }>(items: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((x) => {
    const hay = `${x.name} ${x.blurb ?? ""} ${x.keywords ?? ""} ${x.id ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The page where the person creates a key for this provider. */
export const keyPageUrl = (f: Featured) => `https://${f.keysAt}`;

/** The create_tool payload for a featured tool and the person's key. */
export function featuredPayload(f: Featured, token: string, model?: string) {
  return { name: f.name, endpoint_url: f.endpoint_url, request_format: f.request_format, model: (model ?? f.model).trim() || undefined, auth_header: f.auth_header, auth_scheme: f.auth_scheme, token: token.trim() };
}

export type ConnectorDraft = { name: string; url: string; format: string; token: string; model: string };

/** What is wrong with the custom connector form, and a note when the address looks like an MCP server. */
export function checkConnector(d: ConnectorDraft): { errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const notes: string[] = [];
  if (!d.name.trim()) errors.push("Give the tool a name.");
  else if (d.name.trim().length > 80) errors.push("The name is limited to 80 characters.");
  const raw = d.url.trim();
  let u: URL | null = null;
  try { u = new URL(raw); } catch { /* reported below */ }
  if (!raw) errors.push("Enter the tool's address.");
  else if (!u) errors.push("That is not a web address. It must start with https://");
  else if (u.protocol !== "https:") errors.push("The address must start with https://");
  else if (u.username || u.password) errors.push("Leave the user name and password out of the address; use the key field.");
  const looksMcp = !!u && /\/(mcp|sse)\/?$/i.test(u.pathname);
  if (d.format === "mcp") {
    notes.push("Outer Control will speak the MCP protocol (Streamable HTTP) to this server. The Test button lists its tools. Put the name of the tool to use in the Tool name field; it can stay empty when the server offers just one.");
    if (u && /\/sse\/?$/i.test(u.pathname)) notes.push("An address ending in /sse is the older MCP transport, which is not supported. Use the server's Streamable HTTP address (usually ending in /mcp).");
  } else if (looksMcp) {
    notes.push("This looks like an MCP server address. Choose \"MCP server\" as the format so Outer Control speaks the MCP protocol; with another format it sends plain HTTPS requests, which an MCP server usually rejects.");
  }
  if (d.format === "anthropic_messages" && !d.model.trim()) notes.push("Anthropic-style endpoints need a model name.");
  return { errors, notes };
}

// ---------------------------------------------------------------------------------------
// Live activity of a session: what is being asked, what Outer Control checks and changes, and the outcome

export type ActivityStep = {
  step_no: number; attempt: number; verdict: string | null; next_action: string | null; error: string | null; note: string | null;
  decision?: DecisionView | null;
};
export type ActivityTone = "ok" | "warn" | "bad" | "live" | "idle";
export type ActivityLine = { key: string; tone: ActivityTone; text: string };

const VERDICT_TEXT: Record<string, { tone: ActivityTone; text: (names: string) => string }> = {
  allow: { tone: "ok", text: () => "Checked the reply against your rules: nothing stopped it." },
  modify: { tone: "warn", text: (n) => `Your rules changed the reply${n ? ` (${n})` : ""}; the cleaned version is used.` },
  block: { tone: "bad", text: (n) => `Your rules blocked the reply${n ? ` (${n})` : ""}.` },
  escalate: { tone: "warn", text: (n) => `The reply needs a person's approval${n ? ` (${n})` : ""}.` },
};

/**
 * One line per thing that really happened, in order, from the recorded exchanges. While the session is open, the last
 * line says what it is waiting for. Nothing is invented: a phase with no record has no line.
 */
export function buildActivity(i: {
  toolName: string; status: SessionStatus; steps: ActivityStep[]; completion: CompletionView | null | undefined;
  pendingKind: PendingKind | null; stepCount: number; maxSteps: number;
}): ActivityLine[] {
  const lines: ActivityLine[] = [];
  const ordered = [...i.steps].sort((a, b) => a.step_no - b.step_no || a.attempt - b.attempt);
  for (const s of ordered) {
    const tag = `Step ${s.step_no}${s.attempt > 1 ? ` (try ${s.attempt})` : ""}`;
    const k = `${s.step_no}.${s.attempt}`;
    lines.push({ key: `${k}.ask`, tone: "idle", text: `${tag}: asked ${i.toolName}.` });
    if (s.error) {
      lines.push({ key: `${k}.err`, tone: "bad", text: `${i.toolName} gave no usable reply: ${s.error}` });
    } else {
      const names = [...new Set([...(s.decision?.applied ?? []), ...(s.decision?.changes ?? []).map((c) => c.name)])].join(", ");
      const v = VERDICT_TEXT[s.verdict ?? ""];
      if (v) lines.push({ key: `${k}.verdict`, tone: v.tone, text: v.text(names) });
      for (const c of s.decision?.changes ?? []) lines.push({ key: `${k}.chg.${c.name}`, tone: "warn", text: `Removed ${c.count}× "${c.name}" from the reply.` });
      const r = s.decision?.risk?.level; const c = s.decision?.confidence?.level;
      if (r || c) lines.push({ key: `${k}.rc`, tone: "idle", text: `Risk ${r ?? "unknown"} · confidence ${c ?? "unknown"}.` });
    }
    if (s.next_action) lines.push({ key: `${k}.next`, tone: s.next_action === "reject" || s.next_action === "fail" ? "bad" : "idle", text: `Then: ${NEXT_ACTION_LABEL[s.next_action] ?? s.next_action}.` });
  }
  if (i.status === "running") {
    const last = ordered[ordered.length - 1];
    const asking = !last || last.next_action === "continue" || last.next_action === "retry_with_correction" || last.next_action === "retry_same" || last.next_action === "modify_request";
    lines.push({ key: "live", tone: "live", text: asking ? `Waiting for ${i.toolName}'s reply (step ${Math.max(i.stepCount + 1, last ? last.step_no : 1)} of at most ${i.maxSteps})…` : "Running the final completion check…" });
  } else if (i.status === "queued") {
    lines.push({ key: "live", tone: "idle", text: "Not started: waiting for an earlier step to finish." });
  } else if (i.status === "awaiting_human") {
    lines.push({ key: "live", tone: "warn", text: i.pendingKind === "handoff" ? "Waiting for your decision on how to continue." : "Waiting for you: see the box above." });
  }
  const c = i.completion;
  if (c && Array.isArray(c.criteria) && !["running", "queued"].includes(i.status)) {
    const met = c.criteria.filter((x) => x.ok === true).length;
    lines.push({ key: "completion", tone: c.passed ? "ok" : "bad", text: c.passed ? `Completion check passed (${met}/${c.criteria.length}).` : `Completion check not passed (${met}/${c.criteria.length}).` });
  }
  return lines;
}

// ---------------------------------------------------------------------------------------
// Multi-AI report

/** Internal tools (the NazAI report writer, your agents) are not connections the person manages as tools. */
export const isInternalTool = (endpoint: string) => endpoint.startsWith("nazai-internal://");

export const MIN_REPORT_TOOLS = 1;
export const MAX_REPORT_TOOLS = 5;

/** What is wrong with the report form, or null when it can be started. */
export function checkReportForm(topic: string, toolIds: string[]): string | null {
  const t = topic.replace(/\s+/g, " ").trim();
  if (t.length < 5) return "Say what the report is about (at least 5 characters).";
  if (t.length > 600) return "Keep the topic under 600 characters.";
  if (toolIds.length < MIN_REPORT_TOOLS) return MIN_REPORT_TOOLS === 1 ? "Choose at least one tool to ask." : `Choose at least ${MIN_REPORT_TOOLS} tools to ask.`;
  if (toolIds.length > MAX_REPORT_TOOLS) return `Choose at most ${MAX_REPORT_TOOLS} tools.`;
  return null;
}

// ---------------------------------------------------------------------------------------
// The end of a session

const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const closedAt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${SHORT_MONTH[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};

/**
 * The closing record of a session, said plainly: when contact with the tool ended, how many exchanges there were, and where the
 * result is. Null while the session is still open. A session that did not complete says why it ended and that nothing more is sent.
 */
export function describeClosure(s: { status: string; finished_at: string | null; step_count: number; stop_reason: string | null; toolName: string }): { text: string; tone: "ok" | "warn" } | null {
  if (!s.finished_at || s.status === "queued" || s.status === "running" || s.status === "awaiting_human") return null;
  const when = closedAt(s.finished_at);
  const stamp = when ? ` ${when}` : "";
  if (s.status === "completed") {
    const n = Math.max(0, s.step_count);
    return { tone: "ok", text: `Session closed${stamp}. ${n} exchange${n === 1 ? "" : "s"} with ${s.toolName}. The final controlled result is stored above, and nothing more is sent to the tool in this session.` };
  }
  const how = s.status === "cancelled" ? "cancelled" : s.status === "stopped" ? "stopped" : s.status === "skipped" ? "skipped" : s.status === "rejected" ? "rejected" : "failed";
  const why = s.stop_reason ? ` ${s.stop_reason.replace(/\s+/g, " ").trim().replace(/[.!?]*$/, ".")}` : "";
  return { tone: "warn", text: `Session closed${stamp} (${how}).${why} Nothing more is sent to the tool in this session.` };
}

// ---------------------------------------------------------------------------------------
// Usage

export type ToolUsage = { tool_id: string; requests_30d: number; failed_30d: number; requests_today: number };

/** One line on how much a tool has been used: requests in the last 30 days, how many failed, and today's count. Null when it was never asked. */
export function describeUsage(u: Pick<ToolUsage, "requests_30d" | "failed_30d" | "requests_today"> | null | undefined): string | null {
  const n = Number(u?.requests_30d ?? 0);
  if (!u || !Number.isFinite(n) || n <= 0) return null;
  const failed = Math.max(0, Number(u.failed_30d) || 0);
  const today = Math.max(0, Number(u.requests_today) || 0);
  return `Asked ${n} time${n === 1 ? "" : "s"} in 30 days${failed ? ` · ${failed} failed` : ""}${today ? ` · ${today} today` : ""}`;
}

