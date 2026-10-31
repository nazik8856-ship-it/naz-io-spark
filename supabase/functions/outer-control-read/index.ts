// outer-control-read — data encryption, front 3: Outer Control content is stored encrypted, so the website reads it through here
// instead of straight from the tables. The request is the same query the website used to send to the database (a table, the
// columns, filters, order and limit); it runs as the signed-in user, so row level security decides what comes back exactly as it
// did for the direct read, and the encrypted columns come back decrypted. Read-only: no insert, update or delete is accepted.
//
//   POST { table, ops: [{ m: "select", a: ["id, objective, status"] }, { m: "eq", a: ["user_id", "…"] }, { m: "order", a: ["started_at", { ascending: false }] }, …] }
//   → { data, error }
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "../_shared/encrypted-client.ts"; // encrypts Outer Control content (data encryption, front 3)
import { validRead } from "../_shared/outer-control-read.ts";
import { requireCaller } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  const problem = validRead(body);
  if (problem) return json({ data: null, error: { message: problem } }, 400);
  try {
    // The signed-in user's own client: their row level security applies, as for a direct read.
    const authed = await requireCaller(req, (h) => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: h } } }));
    if (!authed.ok) return json({ error: "unauthorized" }, 401);
    const db = authed.caller.userClient;
    // deno-lint-ignore no-explicit-any
    let q: any = db.from(body.table);
    for (const o of body.ops as { m: string; a: unknown[] }[]) q = q[o.m](...o.a);
    const { data, error, count } = await q;
    return json({ data: data ?? null, error: error ? { message: error.message, code: error.code } : null, ...(typeof count === "number" ? { count } : {}) });
  } catch (e) {
    console.error("outer-control-read failed:", e instanceof Error ? e.message : e);
    return json({ data: null, error: { message: "Could not read this. Try again." } }, 500);
  }
});
