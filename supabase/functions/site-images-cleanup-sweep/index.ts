// Removes the files that outlived their site or account (user & data isolation: deleting something removes its public pictures too).
//
//  - mission-assets/website-images/…  generated pictures and published copies of uploads, for sites that no longer exist
//  - user-uploads/<user>/…            a user's private attached files, for accounts that no longer exist
//
// Conservative on purpose: a folder is left alone while its site/account exists, while a page, a saved version or a shared copy still
// points at it, and while any of its files is newer than the grace period (1 day for site pictures, 7 for private uploads). A lookup
// that fails or is unsure keeps the files. Bounded per run. Send { "dry_run": true } to see what it would remove without removing it.
// Server key only (daily schedule, see 20261105050000_site_images_cleanup.sql).
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { areConsequentialSweepsPaused } from "../_shared/consequential-sweep-pause.ts";
import { siteFolders, topFolders, planRemovals, type PlanItem } from "../_shared/orphan-files.ts";
import { timingSafeEqual } from "../_shared/timing-safe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DAY = 86_400_000;
const SITE_GRACE_MS = DAY;
const UPLOAD_GRACE_MS = 7 * DAY;
const MAX_FILES_PER_RUN = 500;   // per bucket
const REMOVE_CHUNK = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceKey || !timingSafeEqual(token, serviceKey)) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  if (await areConsequentialSweepsPaused(admin)) return json({ ok: true, skipped: true, reason: "consequential sweeps are paused" });

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  // Removes up to MAX_FILES_PER_RUN files of the folders the plan marked for removal; the rest waits for the next run.
  const apply = async (bucket: string, plan: PlanItem[]) => {
    const wanted = plan.filter((p) => p.verdict === "remove");
    const paths: string[] = [];
    for (const p of wanted) { for (const f of p.files) if (paths.length < MAX_FILES_PER_RUN) paths.push(f); }
    let removed = 0, failed = 0;
    if (!dryRun) {
      for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
        const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + REMOVE_CHUNK));
        if (error) failed += Math.min(REMOVE_CHUNK, paths.length - i); else removed += Math.min(REMOVE_CHUNK, paths.length - i);
      }
    }
    const kept = plan.reduce<Record<string, number>>((m, p) => (p.verdict === "remove" ? m : { ...m, [p.verdict]: (m[p.verdict] ?? 0) + 1 }), {});
    return { bucket, folders: plan.length, folders_to_clean: wanted.length, files_found: wanted.reduce((n, p) => n + p.files.length, 0), files_removed: removed, files_failed: failed, kept, ...(dryRun ? { would_remove: paths } : {}) };
  };

  try {
    // Public pictures of sites that are gone.
    const images = admin.storage.from("mission-assets");
    const sitePlan = await planRemovals(images, await siteFolders(images), {
      exist: async (ids) => {
        const { data, error } = await admin.from("websites").select("id").in("id", ids);
        if (error) throw new Error(`websites lookup failed: ${error.message}`);
        return new Set((data ?? []).map((r: { id: string }) => r.id));
      },
      inUse: async (id) => {
        const { data, error } = await admin.rpc("site_image_folder_in_use", { _site: id });
        if (error) throw new Error(`in-use lookup failed: ${error.message}`);
        return data === true;
      },
      graceMs: SITE_GRACE_MS,
    });

    // Private files of accounts that are gone. Only a plain "not found" counts as gone; any other answer keeps the files.
    const uploads = admin.storage.from("user-uploads");
    const uploadPlan = await planRemovals(uploads, await topFolders(uploads), {
      exist: async (ids) => {
        const alive = new Set<string>();
        for (const id of ids) {
          const { data, error } = await admin.auth.admin.getUserById(id);
          const status = (error as { status?: number } | null)?.status;
          if (data?.user || !error || status !== 404) alive.add(id);
        }
        return alive;
      },
      graceMs: UPLOAD_GRACE_MS,
    });

    const result = { ok: true, dry_run: dryRun, site_images: await apply("mission-assets", sitePlan), private_uploads: await apply("user-uploads", uploadPlan) };
    console.log("[site-images-cleanup-sweep]", JSON.stringify({ ...result, site_images: { ...result.site_images, would_remove: undefined }, private_uploads: { ...result.private_uploads, would_remove: undefined } }));
    return json(result);
  } catch (e) {
    // A failed lookup stops the run: nothing is removed on a guess.
    console.error("[site-images-cleanup-sweep] stopped:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "stopped before removing anything it was unsure about" }, 500);
  }
});
