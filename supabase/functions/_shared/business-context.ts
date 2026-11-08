// get_business_context(): the account's agents, clients, insights, reports and artifacts in one call (simulate-scenario,
// analyze-org-insights). The clients' details, the insights and the report text are stored encrypted (data at rest), so the
// database function returns them sealed ("<col>_enc", with each row's id) and they are opened here.
import { openRows } from "./encrypted-db.ts";
import type { FieldKeys } from "./field-crypto.ts";

type Row = Record<string, unknown>;
type Context = { agents?: Row[]; clients?: Row[]; insights?: Row[]; recent_reports?: Row[]; [k: string]: unknown };

/** The report text the model sees is cut to this many characters (what the database function did before). */
export const REPORT_CHARS = 2000;

export async function openBusinessContext(ctx: unknown, keys?: FieldKeys | null): Promise<Context> {
  if (!ctx || typeof ctx !== "object") return {};
  const c = { ...(ctx as Context) };
  // An agent's goal and role are stored encrypted too (data at rest, security task 1).
  if (Array.isArray(c.agents)) c.agents = await openRows("agents", c.agents, keys);
  if (Array.isArray(c.clients)) c.clients = await openRows("agent_clients", c.clients, keys);
  if (Array.isArray(c.insights)) c.insights = await openRows("org_insights", c.insights, keys);
  if (Array.isArray(c.recent_reports)) {
    const opened = await openRows("agent_reports", c.recent_reports, keys);
    c.recent_reports = opened.map((r) => (typeof r.body_markdown === "string" ? { ...r, body_markdown: r.body_markdown.slice(0, REPORT_CHARS) } : r));
  }
  return c;
}
