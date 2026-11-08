// Data encryption: content columns (an agent's goal, role and configuration, an event's details…) are stored encrypted, so the MCP
// tools read them through the outer-control-read edge function, as the signed-in user (same row level security) and decrypted, the
// same way the website does. ops is the query as supabase-js would build it: select first, then filters and shaping.
type Op = { m: string; a: unknown[] };
export type ServerRead = { data: unknown; error: { message: string } | null };

export async function serverRead(token: string, table: string, ops: Op[]): Promise<ServerRead> {
  const resp = await fetch(`${process.env.SUPABASE_URL}/functions/v1/outer-control-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_PUBLISHABLE_KEY! },
    body: JSON.stringify({ table, ops }),
  });
  const body = (await resp.json().catch(() => null)) as ServerRead | null;
  return body ?? { data: null, error: { message: `Could not read ${table} (HTTP ${resp.status}).` } };
}
