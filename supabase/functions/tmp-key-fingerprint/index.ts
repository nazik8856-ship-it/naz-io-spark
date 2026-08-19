// TEMPORARY diagnostic. Returns only a fingerprint (never the value) of the
// service-role key the edge runtime injects, so cron auth mismatches can be
// diagnosed. Delete after use.
const sha = async (s: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async () => {
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return new Response(
    JSON.stringify({
      present: k.length > 0,
      len: k.length,
      prefix: k.slice(0, 8),
      sha256: k ? await sha(k) : null,
      url: Deno.env.get("SUPABASE_URL") ?? null,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
