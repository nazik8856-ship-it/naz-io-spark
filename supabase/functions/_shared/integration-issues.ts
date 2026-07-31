// Known-issue memory for non-retryable tool failures.
//
// When a tool fails with an error class the model can never fix by retrying
// (expired token, missing OAuth scope, revoked permission, exhausted quota, or
// a genuine "we need a human answer" blocker), we persist it in
// `public.integration_issues` keyed by user + provider + tool kind + issue key.
//
// On every later run the runtime checks this table FIRST and skips execution
// entirely for a known unresolved blocker — surfacing the same plain-language
// fix message instead of burning attempts rediscovering the same failure.
//
// Rows are cleared automatically when the user reconnects the integration
// (see `resolveIssuesForProvider`) or answers the question once (the answer is
// stored on the row and replayed to the agent on future runs, so the human is
// never asked again).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type IssueErrorType = "auth_error" | "permission_error" | "quota_error" | "needs_input";
export type FixAction = "reconnect" | "input" | "external";

export type IntegrationIssue = {
  id: string;
  provider: string;
  tool_kind: string;
  error_type: string;
  issue_key: string;
  title: string;
  human_message: string;
  fix_action: string;
  scope_hint: string | null;
  status: string;
  resolution: Record<string, unknown>;
};

/** Which integration a tool kind depends on, in user-facing words. */
export function providerForTool(kind: string, input?: Record<string, unknown>): string {
  const k = (kind || "").toLowerCase();
  if (k === "send_email" || k === "read_email" || k === "reply_email") return "Gmail";
  if (k === "create_doc" || k === "edit_doc") return "Google Docs";
  if (k === "create_sheet" || k === "edit_sheet") return "Google Sheets";
  if (k === "create_calendar_event") return "Google Calendar";
  if (k === "integration_query" || k === "sync_integrations") {
    const p = typeof input?.provider === "string" ? input.provider.trim() : "";
    return p || "Connected apps";
  }
  if (k.includes("canva")) return "Canva";
  if (k.includes("slack")) return "Slack";
  if (k.includes("notion")) return "Notion";
  if (k.includes("shopify")) return "Shopify";
  if (k.includes("figma")) return "Figma";
  return "NazAI";
}

/** Best-effort extraction of the specific missing scope/permission. */
export function scopeHintFromError(text: string): string | null {
  const t = text || "";
  const url = t.match(/https:\/\/www\.googleapis\.com\/auth\/[a-z0-9._-]+/i);
  if (url) return url[0];
  const named = t.match(/scope[s]?[:\s"']+([a-z0-9._:\-\/ ,]+)/i);
  if (named) return named[1].trim().slice(0, 120);
  if (/insufficient authentication scopes/i.test(t)) return "additional permissions";
  return null;
}

/** Stable key so repeat failures update one row instead of piling up. */
export function issueKeyFor(errorType: string, scopeHint: string | null): string {
  return `${errorType}${scopeHint ? `:${scopeHint}` : ""}`.slice(0, 180);
}

/** Plain-language message + fix instruction, never internal log text. */
export function humanIssueCopy(opts: {
  provider: string;
  errorType: IssueErrorType;
  scopeHint: string | null;
  toolLabel?: string;
}): { title: string; message: string; fixAction: FixAction } {
  const { provider, errorType, scopeHint } = opts;
  const scopeWords = scopeHint && scopeHint !== "additional permissions"
    ? `“${scopeHint.replace("https://www.googleapis.com/auth/", "")}”`
    : "extra";
  switch (errorType) {
    case "permission_error":
      return {
        title: `${provider} needs additional permissions`,
        message: `${provider} refused the request because this connection is missing ${scopeWords} access. Reconnect ${provider} and approve that permission — then this step will run on its own.`,
        fixAction: "reconnect",
      };
    case "auth_error":
      return {
        title: `${provider} needs to be reconnected`,
        message: `The ${provider} connection has expired or was revoked, so nothing was sent or changed. Sign in to ${provider} again to restore it.`,
        fixAction: "reconnect",
      };
    case "quota_error":
      return {
        title: `${provider} allowance used up`,
        message: `${provider} has run out of allowance for this account, so the step was stopped. Upgrade or free up quota in ${provider}, then try again.`,
        fixAction: "external",
      };
    case "needs_input":
    default:
      return {
        title: `NazAI needs one detail from you`,
        message: `The agent can't finish this step without an answer from you. Provide it once and NazAI will remember it for every future run.`,
        fixAction: "input",
      };
  }
}

/** Look up an unresolved blocker before spending an attempt. */
export async function findOpenIssue(
  admin: SupabaseClient,
  userId: string,
  provider: string,
  toolKind: string,
): Promise<IntegrationIssue | null> {
  const { data } = await admin
    .from("integration_issues")
    .select("id, provider, tool_kind, error_type, issue_key, title, human_message, fix_action, scope_hint, status, resolution")
    .eq("user_id", userId)
    .eq("status", "open")
    .eq("provider", provider)
    .in("tool_kind", [toolKind, "any"])
    .order("last_seen_at", { ascending: false })
    .limit(1);
  const row = (data || [])[0];
  return (row as IntegrationIssue) || null;
}

/** Record (or refresh) a known non-retryable blocker. */
export async function recordIssue(
  admin: SupabaseClient,
  opts: {
    userId: string;
    agentId?: string | null;
    provider: string;
    toolKind: string;
    errorType: IssueErrorType;
    technical?: string;
    scopeHint?: string | null;
  },
): Promise<IntegrationIssue | null> {
  const scopeHint = opts.scopeHint ?? scopeHintFromError(opts.technical || "");
  const key = issueKeyFor(opts.errorType, scopeHint);
  const copy = humanIssueCopy({ provider: opts.provider, errorType: opts.errorType, scopeHint });

  const { data: existing } = await admin
    .from("integration_issues")
    .select("id, occurrences")
    .eq("user_id", opts.userId)
    .eq("provider", opts.provider)
    .eq("tool_kind", opts.toolKind)
    .eq("issue_key", key)
    .maybeSingle();

  const base = {
    user_id: opts.userId,
    agent_id: opts.agentId ?? null,
    provider: opts.provider,
    tool_kind: opts.toolKind,
    error_type: opts.errorType,
    issue_key: key,
    title: copy.title,
    human_message: copy.message,
    fix_action: copy.fixAction,
    scope_hint: scopeHint,
    technical: (opts.technical || "").slice(0, 600),
    status: "open",
    last_seen_at: new Date().toISOString(),
    resolved_at: null,
  };

  if (existing?.id) {
    const { data } = await admin
      .from("integration_issues")
      .update({ ...base, occurrences: (existing.occurrences as number || 1) + 1 })
      .eq("id", existing.id)
      .select("id, provider, tool_kind, error_type, issue_key, title, human_message, fix_action, scope_hint, status, resolution")
      .maybeSingle();
    return (data as IntegrationIssue) || null;
  }
  const { data } = await admin
    .from("integration_issues")
    .insert(base)
    .select("id, provider, tool_kind, error_type, issue_key, title, human_message, fix_action, scope_hint, status, resolution")
    .maybeSingle();
  return (data as IntegrationIssue) || null;
}

/** Clear every open blocker for a provider once it reconnects successfully. */
export async function resolveIssuesForProvider(
  admin: SupabaseClient,
  userId: string,
  providers: string[],
): Promise<void> {
  if (!providers.length) return;
  await admin
    .from("integration_issues")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "open")
    .in("provider", providers);
}

/** Providers whose blockers a given OAuth connection clears. */
export function providersClearedBy(provider: string): string[] {
  const p = (provider || "").toLowerCase();
  if (p.includes("gmail") || p === "google") {
    return ["Gmail", "Google Docs", "Google Sheets", "Google Calendar", "Google Drive", "Google Analytics"];
  }
  return [provider];
}

/**
 * Answers the user has already given for operator-only questions. Replayed
 * into the agent's context so the same question is never asked twice.
 */
export async function loadKnownAnswers(
  admin: SupabaseClient,
  userId: string,
): Promise<{ question: string; answer: string }[]> {
  const { data } = await admin
    .from("integration_issues")
    .select("title, resolution, status, error_type")
    .eq("user_id", userId)
    .eq("error_type", "needs_input")
    .eq("status", "resolved")
    .order("resolved_at", { ascending: false })
    .limit(40);
  return (data || [])
    .map((r) => {
      const res = (r.resolution as Record<string, unknown>) || {};
      const q = String(res.question || r.title || "").trim();
      const a = String(res.answer || "").trim();
      return q && a ? { question: q, answer: a } : null;
    })
    .filter(Boolean) as { question: string; answer: string }[];
}

/** Persist an operator-only question as a blocker awaiting human input. */
export async function recordQuestionIssue(
  admin: SupabaseClient,
  opts: { userId: string; agentId?: string | null; question: string; options?: string[] },
): Promise<IntegrationIssue | null> {
  const key = `needs_input:${opts.question.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)}`;
  const { data: existing } = await admin
    .from("integration_issues")
    .select("id, resolution, status")
    .eq("user_id", opts.userId)
    .eq("provider", "NazAI")
    .eq("tool_kind", "ask_user")
    .eq("issue_key", key)
    .maybeSingle();
  if (existing?.id) {
    if (existing.status === "resolved") return null; // answer already known
    return null;
  }
  const { data } = await admin
    .from("integration_issues")
    .insert({
      user_id: opts.userId,
      agent_id: opts.agentId ?? null,
      provider: "NazAI",
      tool_kind: "ask_user",
      error_type: "needs_input",
      issue_key: key,
      title: opts.question.slice(0, 180),
      human_message: opts.question,
      fix_action: "input",
      status: "open",
      resolution: { question: opts.question, options: opts.options || [] },
    })
    .select("id, provider, tool_kind, error_type, issue_key, title, human_message, fix_action, scope_hint, status, resolution")
    .maybeSingle();
  return (data as IntegrationIssue) || null;
}
