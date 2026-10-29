// Data encryption, fronts 3 and 4: what encrypted-write accepts. The website used to write a few encrypted tables directly (an
// agent's clarification answer, a scheduled run, a Generator request, a knowledge-base entry); now the same write goes through
// the server so the content is encrypted before it is stored. Only the writes each table needs are accepted, built from plain data,
// and an update or delete must say which rows (a filter) — row level security still decides what the user may touch.
import { ENCRYPTED_COLUMNS } from "./encrypted-db.ts";

/** The writes the website makes, per table. */
export const WRITABLE: Record<string, string[]> = {
  agent_runs: ["insert"],
  agent_events: ["insert"],
  missions: ["insert", "update", "delete"],
  knowledge_base_entries: ["insert", "update", "delete"],
  // An approver's sign-off with a comment: record_approval_signoff runs as the approver (its quorum rules unchanged), then the
  // comment is stored encrypted. A team approver may sign off but not edit the row, so the comment is written by the server.
  pending_approvals: ["signoff"],
};

export type Signoff = { approval_id: string; vote: "approve" | "reject"; comment?: string | null; reason_code?: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = new Set(["eq", "neq", "in", "is", "not", "gt", "gte", "lt", "lte"]);
const SHAPES = new Set(["select", "single", "maybeSingle"]);
const MAX_BYTES = 2_000_000; // a Generator request carries the generated code

/** Plain data only: text, numbers, booleans, null, and lists/objects of those (the values of a row can be nested JSON). */
function plain(v: unknown, depth = 0): boolean {
  if (v === null || ["string", "number", "boolean"].includes(typeof v)) return true;
  if (depth > 8) return false;
  if (Array.isArray(v)) return v.every((x) => plain(x, depth + 1));
  if (typeof v === "object") return Object.getPrototypeOf(v) === Object.prototype && Object.values(v as object).every((x) => plain(x, depth + 1));
  return false;
}

export function validWrite(body: unknown): string | null {
  const b = body as { table?: unknown; ops?: unknown };
  if (!b || typeof b.table !== "string" || !WRITABLE[b.table] || !ENCRYPTED_COLUMNS[b.table]) return "unknown table";
  if (!Array.isArray(b.ops) || b.ops.length < 1 || b.ops.length > 20) return "ops must be 1 to 20 steps";
  if (JSON.stringify(b.ops).length > MAX_BYTES) return "too large";
  const [first, ...rest] = b.ops as { m?: unknown; a?: unknown }[];
  if (typeof first?.m !== "string" || !WRITABLE[b.table].includes(first.m)) return `not allowed on ${b.table}: ${String(first?.m)}`;
  const args = Array.isArray(first.a) ? first.a : [];
  if (first.m === "signoff") {
    const x = args[0] as Partial<Signoff> | undefined;
    if (rest.length || !x || typeof x.approval_id !== "string" || !UUID.test(x.approval_id) || (x.vote !== "approve" && x.vote !== "reject")) return "signoff needs approval_id and vote";
    if (x.comment != null && (typeof x.comment !== "string" || x.comment.length > 800)) return "the comment is at most 800 characters";
    if (x.reason_code != null && typeof x.reason_code !== "string") return "invalid reason_code";
    return null;
  }
  if (first.m === "insert") {
    const rows = Array.isArray(args[0]) ? args[0] : [args[0]];
    if (!rows.length || rows.length > 50 || !rows.every((r) => r && typeof r === "object" && !Array.isArray(r) && plain(r))) return "insert needs 1 to 50 rows of plain data";
  }
  if (first.m === "update" && (!args[0] || typeof args[0] !== "object" || Array.isArray(args[0]) || !plain(args[0]))) return "update needs the new values";
  let filtered = false, selected = false;
  for (const o of rest) {
    if (!o || typeof o.m !== "string" || !(FILTERS.has(o.m) || SHAPES.has(o.m))) return `not allowed: ${String(o?.m)}`;
    if (!Array.isArray(o.a) || o.a.length > 3 || !o.a.every((x) => plain(x, 6))) return `invalid arguments for ${o.m}`;
    if (FILTERS.has(o.m)) { if (selected) return "filters come before select"; filtered = true; }
    if (o.m === "select") { if (typeof o.a[0] !== "string" || o.a[0].length > 2000) return "select needs a column list"; selected = true; }
  }
  if ((first.m === "update" || first.m === "delete") && !filtered) return `${first.m} needs a filter saying which rows`;
  return null;
}
