// An agent's remembered facts (agent_memory): the value is stored encrypted and bound to its row id (data at rest), so a fact is
// replaced by updating its own row, never with an upsert on (agent_id, key), which would seal the value for a new id that the
// database then throws away.
// deno-lint-ignore no-explicit-any
type Db = any;
export type MemoryRow = { agent_id: string; user_id: string; key: string; value: string; source: string };

/** Adds each fact, or replaces the value of the agent's fact with the same key. Returns how many were added and replaced. */
export async function rememberFacts(db: Db, agentId: string, rows: MemoryRow[]): Promise<{ added: number; replaced: number; error: string | null }> {
  if (!rows.length) return { added: 0, replaced: 0, error: null };
  const { data: existing, error } = await db.from("agent_memory").select("id, key").eq("agent_id", agentId).in("key", rows.map((r) => r.key));
  if (error) return { added: 0, replaced: 0, error: error.message };
  const idByKey = new Map(((existing ?? []) as { id: string; key: string }[]).map((r) => [r.key, r.id]));
  let replaced = 0;
  for (const r of rows) {
    const id = idByKey.get(r.key);
    if (!id) continue;
    const { error: upErr } = await db.from("agent_memory").update({ value: r.value, source: r.source }).eq("id", id);
    if (upErr) return { added: 0, replaced, error: upErr.message };
    replaced++;
  }
  const fresh = rows.filter((r) => !idByKey.has(r.key));
  if (fresh.length) {
    const { error: insErr } = await db.from("agent_memory").insert(fresh);
    if (insErr) return { added: 0, replaced, error: insErr.message };
  }
  return { added: fresh.length, replaced, error: null };
}
