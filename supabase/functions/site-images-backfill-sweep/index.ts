// Gives websites that predate custom image generation (images_status IS NULL)
// their pictures without anyone triggering it. New sites and rebuilds are
// kicked off by compile-website-manifest; this sweep covers everything that
// existed before that shipped, plus any site whose kickoff call was lost.
//
// Deliberately slow and bounded: a few sites per run (each costs 5-8 image
// requests of AI gateway credit). A site with nothing to illustrate is marked
// 'done' so it is never looked at again; a site whose generation fails is
// marked 'failed' by generate-site-images and is NOT retried automatically
// (no unbounded credit burn); a failed run also leaves a generation note on the site.
// User-supplied images are never replaced: collectImageSlots skips any slot
// that already has an asset_url.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { areConsequentialSweepsPaused } from "../_shared/consequential-sweep-pause.ts";
import { collectImageSlots } from "../_shared/site-images.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BATCH = 2;            // sites started per run
const SCAN = 20;            // candidates examined per run (most have nothing to do or are skipped quickly)
const SETTLE_MS = 10 * 60_000; // leave brand-new sites to the normal kickoff path

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, serviceKey);

  // Spends AI gateway credits on every account's sites, so it honours the same
  // pause switch as the other sweeps that act across accounts.
  if (await areConsequentialSweepsPaused(admin)) return json({ ok: true, skipped: true, reason: "consequential sweeps are paused" });

  const cutoff = new Date(Date.now() - SETTLE_MS).toISOString();
  const { data: sites, error } = await admin.from("websites")
    .select("id, name, theme")
    .is("images_status", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(SCAN);
  if (error) return json({ error: error.message }, 500);

  let started = 0, markedDone = 0, errors = 0;
  for (const site of (sites ?? []) as { id: string; name: string | null; theme: { layout?: string } | null }[]) {
    if (started >= BATCH) break;
    try {
      const { data: pageRows } = await admin.from("website_pages").select("slug, sections, order_index")
        .eq("website_id", site.id).order("order_index", { ascending: true });
      const pages = ((pageRows ?? []) as { slug: string; sections: unknown }[])
        .map((p) => ({ slug: p.slug, sections: Array.isArray(p.sections) ? p.sections : [] }));
      const slots = collectImageSlots(pages, { siteName: site.name ?? "", layout: site.theme?.layout });
      if (slots.length === 0) {
        await admin.from("websites").update({ images_status: "done" }).eq("id", site.id);
        markedDone++;
        continue;
      }
      const res = await fetch(`${url}/functions/v1/generate-site-images`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", apikey: serviceKey },
        body: JSON.stringify({ website_id: site.id }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 202) started++;
      else { errors++; console.error("site-images-backfill-sweep: generate-site-images returned", res.status, site.id); }
    } catch (e) {
      errors++;
      console.error("site-images-backfill-sweep: site failed", site.id, e);
    }
  }
  return json({ ok: true, scanned: (sites ?? []).length, started, marked_done: markedDone, errors });
});
