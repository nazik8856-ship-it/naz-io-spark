import { supabase } from "@/integrations/supabase/client";

/**
 * Known non-retryable blockers ("integration issues") persisted by the agent
 * runtime. The UI shows them as a plain-language fix window; resolving one
 * (by reconnecting the integration or answering the question once) clears the
 * row so future runs resume normal execution.
 */
export type IntegrationIssue = {
  id: string;
  provider: string;
  tool_kind: string;
  error_type: string;
  title: string;
  human_message: string;
  fix_action: string;
  scope_hint: string | null;
  status: string;
  resolution: Record<string, unknown> | null;
  occurrences: number;
  last_seen_at: string;
  resolved_at: string | null;
};

const TABLE = "integration_issues";

export async function fetchOpenIssues(): Promise<IntegrationIssue[]> {
  const { data } = await supabase
    .from(TABLE)
    .select("id, provider, tool_kind, error_type, title, human_message, fix_action, scope_hint, status, resolution, occurrences, last_seen_at, resolved_at")
    .eq("status", "open")
    .order("last_seen_at", { ascending: false });
  return (data as IntegrationIssue[]) || [];
}

/** Every provider label whose blockers a given reconnect should clear. */
export function providersClearedBy(provider: string): string[] {
  const p = (provider || "").toLowerCase();
  if (p.includes("gmail") || p === "google" || p.includes("google")) {
    return ["Gmail", "Google Docs", "Google Sheets", "Google Calendar", "Google Drive", "Google Analytics", "Google"];
  }
  return [provider];
}

/** Called after a successful (re)connect — clears matching open blockers. */
export async function clearIssuesForProvider(provider: string): Promise<number> {
  const providers = providersClearedBy(provider);
  const { data } = await supabase
    .from(TABLE)
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("status", "open")
    .in("provider", providers)
    .select("id");
  return (data || []).length;
}

/** Store the human's one-time answer so the agent never asks again. */
export async function resolveIssueWithAnswer(issue: IntegrationIssue, answer: string): Promise<void> {
  const resolution = {
    ...(issue.resolution || {}),
    question: (issue.resolution as { question?: string } | null)?.question || issue.title,
    answer,
    answered_at: new Date().toISOString(),
  };
  await supabase
    .from(TABLE)
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolution })
    .eq("id", issue.id);
}

export async function dismissIssue(id: string): Promise<void> {
  await supabase
    .from(TABLE)
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id);
}
