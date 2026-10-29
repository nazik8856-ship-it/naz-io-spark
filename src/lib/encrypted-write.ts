// Data encryption, fronts 3 and 4: a write to a table whose content is stored encrypted goes through the encrypted-write edge
// function, so the content is encrypted before it is stored. ocWrite(table) is used like supabase.from(table) for an insert,
// update or delete (with filters, and select/single to get the row back); the result is the same { data, error }. It runs as the
// signed-in user, so row level security decides exactly as before.
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";

type Op = { m: string; a: unknown[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WriteResult = { data: any; error: { message: string; code?: string } | null };

async function run(table: string, ops: Op[]): Promise<WriteResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/encrypted-write`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ table, ops }),
    });
    const body = await resp.json().catch(() => null);
    if (!body) return { data: null, error: { message: `Could not save (HTTP ${resp.status}).` } };
    return { data: body.data ?? null, error: body.error ?? null };
  } catch {
    return { data: null, error: { message: "Could not reach the server. Try again." } };
  }
}

const METHODS = ["insert", "update", "delete", "eq", "neq", "in", "is", "not", "gt", "gte", "lt", "lte", "select", "single", "maybeSingle"] as const;
type Builder = { [K in (typeof METHODS)[number]]: (...a: unknown[]) => Builder } & PromiseLike<WriteResult>;

/** A write to an encrypted table, built like supabase.from(table).insert(...)... and awaited the same way. */
export function ocWrite(table: string): Builder {
  const ops: Op[] = [];
  const b = {} as Builder;
  for (const m of METHODS) (b as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { ops.push({ m, a }); return b; };
  (b as unknown as PromiseLike<WriteResult>).then = (ok, bad) => run(table, ops).then(ok, bad);
  return b;
}

/**
 * An approver's sign-off with a comment: the same record_approval_signoff (quorum and permissions unchanged), with the comment
 * stored encrypted by the server. Returns what the database function returns.
 */
export function approvalSignoff(x: { approval_id: string; vote: "approve" | "reject"; comment?: string | null; reason_code?: string | null }): Promise<WriteResult> {
  return run("pending_approvals", [{ m: "signoff", a: [x] }]);
}
