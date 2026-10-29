// encrypted-write — data encryption, fronts 3 and 4: the website's writes to tables whose content is stored encrypted (an agent's
// clarification answer, a scheduled run, a Generator request, a knowledge-base entry). The request is the same write the website
// used to send to the database; it runs as the signed-in user, so row level security decides exactly as before, and the content
// is encrypted (DATA_KEY) before it is stored. Only the writes listed in _shared/encrypted-write.ts are accepted.
//
//   POST { table, ops: [{ m: "insert", a: [{ … }] }, { m: "select", a: ["id"] }, { m: "single", a: [] }] }
//   POST { table, ops: [{ m: "update", a: [{ … }] }, { m: "eq", a: ["id", "…"] }] }
//   → { data, error }
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "../_shared/encrypted-client.ts"; // encrypts stored content (data encryption, fronts 3 and 4)
import { validWrite, type Signoff } from "../_shared/encrypted-write.ts";

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
  const problem = validWrite(body);
  if (problem) return json({ data: null, error: { message: problem } }, 400);
  try {
    // The signed-in user's own client: their row level security applies, as for a direct write.
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    if (body.ops[0].m === "signoff") {
      const x = body.ops[0].a[0] as Signoff;
      // As the approver: the database function checks they may sign off and applies the quorum, exactly as before.
      const { data, error } = await db.rpc("record_approval_signoff", { _approval_id: x.approval_id, _vote: x.vote, _comment: null, _reason_code: x.reason_code ?? null });
      if (error) return json({ data: null, error: { message: error.message, code: error.code } });
      const comment = (x.comment ?? "").slice(0, 800).trim();
      if (comment && !(data as { already_resolved?: boolean } | null)?.already_resolved) {
        // The sign-off was accepted, so they may comment on it; the comment is stored encrypted.
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { error: cErr } = await admin.from("pending_approvals").update({ comment }).eq("id", x.approval_id);
        if (cErr) console.error("encrypted-write: comment not saved:", cErr.message);
      }
      return json({ data, error: null });
    }
    // deno-lint-ignore no-explicit-any
    let q: any = db.from(body.table);
    for (const o of body.ops as { m: string; a: unknown[] }[]) q = q[o.m](...o.a);
    const { data, error } = await q;
    return json({ data: data ?? null, error: error ? { message: error.message, code: error.code } : null });
  } catch (e) {
    console.error("encrypted-write failed:", e instanceof Error ? e.message : e);
    return json({ data: null, error: { message: "Could not save this. Try again." } }, 500);
  }
});
