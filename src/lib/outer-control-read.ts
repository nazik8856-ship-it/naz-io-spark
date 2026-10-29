// Data encryption, front 3: Outer Control content (objectives, results, replies, memory, evaluations…) is stored encrypted, so a
// screen reads it through the outer-control-read edge function instead of straight from the table. ocRead(table) is used exactly
// like supabase.from(table) for a read: the same select, filters, order and limit, the same { data, error } result. It runs as the
// signed-in user (same row level security) and the content comes back decrypted.
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";

type Op = { m: string; a: unknown[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReadResult = { data: any; error: { message: string; code?: string } | null };

async function run(table: string, ops: Op[]): Promise<ReadResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/outer-control-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ table, ops }),
    });
    const body = await resp.json().catch(() => null);
    if (!body) return { data: null, error: { message: `Could not read (HTTP ${resp.status}).` } };
    return { data: body.data ?? null, error: body.error ?? null };
  } catch {
    return { data: null, error: { message: "Could not reach Outer Control. Try again." } };
  }
}

const METHODS = ["select", "eq", "neq", "in", "is", "not", "gt", "gte", "lt", "lte", "order", "limit", "range", "single", "maybeSingle"] as const;
type Builder = { [K in (typeof METHODS)[number]]: (...a: unknown[]) => Builder } & PromiseLike<ReadResult>;

/** A read of an Outer Control table, built like supabase.from(table).select(...)... and awaited the same way. */
export function ocRead(table: string): Builder {
  const ops: Op[] = [];
  const b = {} as Builder;
  for (const m of METHODS) (b as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { ops.push({ m, a }); return b; };
  (b as unknown as PromiseLike<ReadResult>).then = (ok, bad) => run(table, ops).then(ok, bad);
  return b;
}
