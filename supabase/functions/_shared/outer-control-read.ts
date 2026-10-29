// Data encryption, front 3: what outer-control-read accepts. A read of one of the encrypted Outer Control tables, built like a
// supabase-js query: the column list first, then filters and shaping only. Arguments are plain data.
import { ENCRYPTED_COLUMNS } from "./encrypted-db.ts";

const TABLES = new Set(Object.keys(ENCRYPTED_COLUMNS));
/** Reading only: the first step is the column list, then filters and shaping. */
const METHODS = new Set(["eq", "neq", "in", "is", "not", "gt", "gte", "lt", "lte", "order", "limit", "range", "single", "maybeSingle"]);
const MAX_OPS = 20;

/** An argument is plain data: text, numbers, booleans, null, lists of those, or a small options object (order/range). */
function plainArg(v: unknown, depth = 0): boolean {
  if (v === null || ["string", "number", "boolean"].includes(typeof v)) return typeof v !== "string" || (v as string).length <= 2000;
  if (depth > 1) return false;
  if (Array.isArray(v)) return v.length <= 500 && v.every((x) => plainArg(x, depth + 1));
  if (typeof v === "object") return Object.keys(v as object).length <= 5 && Object.values(v as object).every((x) => plainArg(x, depth + 1));
  return false;
}

export function validRead(body: unknown): string | null {
  const b = body as { table?: unknown; ops?: unknown };
  if (!b || typeof b.table !== "string" || !TABLES.has(b.table)) return "unknown table";
  if (!Array.isArray(b.ops) || b.ops.length < 1 || b.ops.length > MAX_OPS) return "ops must be 1 to 20 steps";
  const [first, ...rest] = b.ops as { m?: unknown; a?: unknown }[];
  if (first?.m !== "select" || !Array.isArray(first.a) || first.a.length !== 1 || typeof first.a[0] !== "string" || first.a[0].length > 2000) return "the first step must be select with a column list";
  for (const o of rest) {
    if (!o || typeof o.m !== "string" || !METHODS.has(o.m)) return `not allowed: ${String(o?.m)}`;
    if (!Array.isArray(o.a) || o.a.length > 3 || !o.a.every((x) => plainArg(x))) return `invalid arguments for ${o.m}`;
  }
  return null;
}

