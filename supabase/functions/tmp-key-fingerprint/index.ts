// TEMPORARY diagnostic/repair. Never returns the key itself — only a
// fingerprint, plus (on ?sync=1) syncs the cron vault secret to the runtime
// service-role key. Delete after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sha = async (s: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const out: Record<string, unknown> = {
    present: k.length > 0,
    len: k.length,
    prefix: k.slice(0, 8),
    sha256: k ? await sha(k) : null,
  };
  if (new URL(req.url).searchParams.get("sync") === "1" && k) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, k);
    const { data, error } = await admin.rpc("__sync_cron_key", { _val: k });
    out.sync = error ? `error: ${error.message}` : data;
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
