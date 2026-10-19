// Outer Control: keeps its connections honest between sessions. A tool that worked last week may have a revoked key today, and
// the person should see that before they start work, not in the middle of it. Every few hours the sweep sends the same real
// connection test a person gets from the Test button to each tool that is in use, and records the result on the tool.
// Only tools used or added in the last 30 days are tested (each test is one short request on the person's own key), and only a
// few per run, oldest first.
import { runConnectionTest, type TestableTool, type TestDeps, type TestOutcome } from "./outer-control-tool-test.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export const KEEPALIVE_AFTER_MS = 12 * 60 * 60 * 1000;
export const KEEPALIVE_USED_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;
export const KEEPALIVE_BATCH = 5;

export type KeepAliveTool = TestableTool & { user_id: string; created_at: string; last_checked_at: string | null };

/** Which of these tools are due for a test, oldest check first (never-checked first), at most `limit`. */
export function pickKeepAliveCandidates(tools: KeepAliveTool[], usedToolIds: Set<string>, now: number, limit = KEEPALIVE_BATCH): KeepAliveTool[] {
  return tools
    .filter((t) => {
      const checked = t.last_checked_at ? Date.parse(t.last_checked_at) : null;
      if (checked !== null && !Number.isNaN(checked) && now - checked < KEEPALIVE_AFTER_MS) return false;
      const created = Date.parse(t.created_at);
      return usedToolIds.has(t.id) || (!Number.isNaN(created) && now - created < KEEPALIVE_USED_WITHIN_MS);
    })
    .sort((a, b) => (a.last_checked_at ? Date.parse(a.last_checked_at) : 0) - (b.last_checked_at ? Date.parse(b.last_checked_at) : 0))
    .slice(0, limit);
}

/** Writes a test result on the tool: when it was checked, when it last worked, and why it failed. */
export async function recordConnectionTest(admin: AnyAdmin, tool: { id: string; last_ok_at: string | null }, outcome: { ok: boolean; error: string | null }, now: number) {
  const at = new Date(now).toISOString();
  await admin.from("external_tools").update({ last_checked_at: at, last_ok_at: outcome.ok ? at : tool.last_ok_at, last_error: outcome.error }).eq("id", tool.id);
}

export type KeepAliveDeps = {
  now: () => number;
  /** Runs the real test. */
  test: (tool: KeepAliveTool) => Promise<TestOutcome>;
  /** A reason not to contact this tool right now: "skip" leaves it untouched (a kill switch is on), a message records a failed check (a contact rule forbids it). */
  gate: (tool: KeepAliveTool) => Promise<"skip" | string | null>;
};

export type KeepAliveResult = { tested: number; failed: number; skipped: number };

export async function runKeepAlive(admin: AnyAdmin, deps: KeepAliveDeps): Promise<KeepAliveResult> {
  const now = deps.now();
  const out: KeepAliveResult = { tested: 0, failed: 0, skipped: 0 };
  const cutoff = new Date(now - KEEPALIVE_AFTER_MS).toISOString();
  // Real outside tools only: agents and the report writer are internal and are checked when they are used.
  const { data } = await admin.from("external_tools")
    .select("id, user_id, name, endpoint_url, request_format, model, auth_header, auth_scheme, credentials_secret_id, last_ok_at, last_checked_at, created_at")
    .eq("enabled", true).is("removed_at", null).is("agent_id", null).not("approved_at", "is", null)
    .not("endpoint_url", "like", "nazai-internal://%")
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true }).limit(KEEPALIVE_BATCH * 6);
  const tools = (data ?? []) as KeepAliveTool[];
  if (tools.length === 0) return out;

  const { data: used } = await admin.from("outer_control_sessions").select("tool_id")
    .in("tool_id", tools.map((t) => t.id)).gte("started_at", new Date(now - KEEPALIVE_USED_WITHIN_MS).toISOString());
  const usedIds = new Set(((used ?? []) as { tool_id: string }[]).map((r) => r.tool_id));

  for (const tool of pickKeepAliveCandidates(tools, usedIds, now)) {
    const gated = await deps.gate(tool);
    if (gated === "skip") { out.skipped++; continue; }
    const outcome = gated ? { ok: false, error: gated, ms: null, sample: null } : await deps.test(tool);
    await recordConnectionTest(admin, tool, outcome, deps.now());
    out.tested++;
    if (!outcome.ok) out.failed++;
  }
  return out;
}

/** The real test, wired to the live fetch and URL safety check. */
export function liveTest(admin: AnyAdmin, deps: TestDeps) {
  return (tool: KeepAliveTool) => runConnectionTest(admin, tool, deps);
}
