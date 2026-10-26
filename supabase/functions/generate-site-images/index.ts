// Generates custom images for a generated website and writes them into its
// pages. POST { website_id } with the owner's session JWT. Returns 202 right
// away and keeps working in the background (EdgeRuntime.waitUntil), updating
// websites.images_status so the preview can poll. Slot selection, prompts and
// safe write-back are pure and tested in _shared/site-images.ts.
//
// Images the user supplied (any section/item that already has an asset_url)
// are never touched. A site whose images all fail keeps the existing
// illustration fallback AND gets a visible generation note -- never silent.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OUT_OF_CREDITS, openIncidentOnce, OUTAGE_SUMMARY, PROVIDER_OUTAGE_KIND } from "../_shared/provider-health.ts";
import { pickAiGateway, aiGatewayHeaders, type GatewayConfig } from "../_shared/ai-gateway.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  applyImageToSections, buildImagePrompt, collectImageSlots, extensionForMime, optimizedImageUrl, parseImageResponse,
  type ImageSlot, type ParsedImage,
} from "../_shared/site-images.ts";
import {
  buildVerifyPrompt, businessSubject, describeGuardTally, emptyTally, kindLabel, parseVerifyResponse, reinforcePrompt,
  subjectMatchesBusiness, withoutImageGuardNotes, type VerifyResult,
} from "../_shared/image-guard.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "mission-assets";
const CONCURRENCY = 3;
const SITE_DEADLINE_MS = 110_000;
const PER_IMAGE_TIMEOUT_MS = 70_000;
const STALE_RUN_MS = 5 * 60_000;
const RETRY_BACKOFF_MS = [2_000, 6_000, 15_000];
const FAILURE_NOTE_PREFIX = "Custom images could not be generated";
const LOVABLE_IMAGE_MODELS = ["google/gemini-2.5-flash-image", "google/gemini-3-pro-image-preview"];
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

async function requestImage(gw: GatewayConfig, model: string, prompt: string, slot: ImageSlot): Promise<{ ok: boolean; status: number; parsed: ParsedImage | null; detail?: string }> {
  const isOpenAi = gw.provider === "openai";
  const url = isOpenAi ? OPENAI_IMAGES_URL : gw.url;
  const body = isOpenAi
    ? { model, prompt, size: slot.aspect === "wide" ? "1536x1024" : "1024x1024", n: 1 }
    : { model, messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] };
  for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length + 1; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: aiGatewayHeaders(gw), body: JSON.stringify(body),
        signal: AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        // Keep the provider's own message: "rate limited" and "out of credits" need different fixes.
        const reason = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
        // A rate-limited gateway usually recovers within seconds: back off and retry.
        if (attempt < RETRY_BACKOFF_MS.length && !OUT_OF_CREDITS.test(reason)) { await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt])); continue; }
        return { ok: false, status: res.status, parsed: null, detail: `provider ${res.status}${reason ? `: ${reason}` : ""}` };
      }
      if (!res.ok) return { ok: false, status: res.status, parsed: null, detail: (await res.text()).slice(0, 200) };
      const parsed = parseImageResponse(await res.json());
      return { ok: !!parsed, status: res.status, parsed, detail: parsed ? undefined : "no image in response" };
    } catch (e) {
      if (attempt === RETRY_BACKOFF_MS.length) return { ok: false, status: 0, parsed: null, detail: e instanceof Error ? e.message : "request failed" };
    }
  }
  return { ok: false, status: 0, parsed: null, detail: "request failed" };
}

async function toBytes(img: ParsedImage): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (img.kind === "base64") {
    const bin = atob(img.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: img.mime };
  }
  const r = await fetch(img.url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return null;
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type")?.split(";")[0] || "image/png" };
}

const VERIFY_TIMEOUT_MS = 25_000;

/**
 * Relevance Guard, image side: shows the finished image (a small WebP rendered
 * by Storage, so no multi-megabyte upload is re-sent) to the chat model and
 * asks whether it matches the subject. Fails OPEN: any error or unreadable
 * answer returns match=null and the image is accepted.
 */
async function verifyImage(gw: GatewayConfig, imageUrl: string, subject: string, ctx: { siteName: string; tagline?: string; brief?: string }): Promise<VerifyResult> {
  try {
    const res = await fetch(gw.url, {
      method: "POST",
      headers: aiGatewayHeaders(gw),
      body: JSON.stringify({
        model: gw.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [
          { type: "text", text: buildVerifyPrompt(subject, ctx) },
          { type: "image_url", image_url: { url: imageUrl } },
        ] }],
      }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { match: null, reason: "" };
    return parseVerifyResponse(await res.json());
  } catch {
    return { match: null, reason: "" };
  }
}

const verifyUrlFor = (path: string) => `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/storage/v1/render/image/public/${BUCKET}/${path}?width=512&quality=60`;

async function run(admin: AnyAdmin, gw: GatewayConfig, opts: { verify: boolean; snapshotFirst: boolean }, site: { id: string; user_id: string; name: string; tagline: string | null; prompt: string | null; theme: { layout?: string } | null }) {
  const started = Date.now();
  let succeeded = 0;
  let failed = 0;
  let lastFailure = "";
  try {
    const { data: pageRows } = await admin.from("website_pages").select("slug, sections, order_index").eq("website_id", site.id).order("order_index", { ascending: true });
    const pages = ((pageRows ?? []) as { slug: string; sections: unknown }[]).map((p) => ({ slug: p.slug, sections: Array.isArray(p.sections) ? p.sections : [] }));
    const slots = collectImageSlots(pages, { siteName: site.name, layout: site.theme?.layout });
    const ctx = { siteName: site.name, tagline: site.tagline ?? undefined, brief: site.prompt ?? undefined };
    const tally = emptyTally();
    // Relevance Guard layer 1: an image_prompt unrelated to the business is
    // rewritten before anything is generated from it.
    const rewritten = new Set<ImageSlot>();
    for (const slot of slots) {
      if (!subjectMatchesBusiness(slot.subject, ctx)) {
        slot.subject = businessSubject(ctx, kindLabel(slot.kind));
        rewritten.add(slot);
        tally.promptsRewritten++;
      }
    }
    if (opts.snapshotFirst && slots.length > 0) {
      // A backfill changes sites their owners did not ask to change: keep the
      // before state so it can be compared and restored.
      try {
        const { data: siteRow } = await admin.from("websites").select("*").eq("id", site.id).maybeSingle();
        // Full page rows: restore_website_version needs title/seo_description too.
        const { data: fullPages } = await admin.from("website_pages").select("*").eq("website_id", site.id);
        await admin.from("website_versions").insert({
          website_id: site.id, user_id: site.user_id, label: "Before custom images",
          website_snapshot: siteRow ?? {}, pages_snapshot: fullPages ?? [],
        });
      } catch (e) { console.warn("[generate-site-images] snapshot failed (non-fatal)", e); }
    }

    let writeChain: Promise<unknown> = Promise.resolve();
    const writeSlot = (slot: ImageSlot, url: string) => {
      writeChain = writeChain.then(async () => {
        // Re-read the row: a chat edit may have landed while this image generated.
        const { data: row } = await admin.from("website_pages").select("id, sections").eq("website_id", site.id).eq("slug", slot.pageSlug).maybeSingle();
        if (!row) return;
        const next = applyImageToSections(Array.isArray(row.sections) ? row.sections : [], slot, url, { replacePrompt: rewritten.has(slot) });
        if (next) await admin.from("website_pages").update({ sections: next }).eq("id", row.id);
      }).catch(() => undefined);
      return writeChain;
    };

    let modelIdx = 0;
    const models = gw.provider === "openai" ? ["gpt-image-1"] : LOVABLE_IMAGE_MODELS;
    let cursor = 0;
    const worker = async () => {
      while (cursor < slots.length && Date.now() - started < SITE_DEADLINE_MS) {
        const slot = slots[cursor++];
        const basePrompt = buildImagePrompt(slot, ctx);
        let prompt = basePrompt;
        let retried = false;
        let lastReason = "";
        // A slot whose retry failed technically (after a mismatch) is still a
        // dropped image for the owner's purposes: count it.
        const dropAfterMismatch = () => {
          if (!retried) return;
          tally.dropped++;
          if (tally.examples.length < 3) tally.examples.push(`${kindLabel(slot.kind)}: first attempt showed ${lastReason || "something unrelated"}`);
        };
        // At most two attempts per slot: the second only after the Relevance
        // Guard rejected the first, with the rejection reason fed back.
        for (let attempt = 0; attempt < 2; attempt++) {
          let result = await requestImage(gw, models[modelIdx], prompt, slot);
          console.log(`[generate-site-images] ${gw.provider}/${models[modelIdx]} ${slot.kind} -> ${result.ok ? "ok" : "fail " + (result.detail ?? result.status)}`);
          // A model the gateway rejects (unknown / not image-capable) falls through to the next candidate.
          while (!result.ok && (result.status === 400 || result.status === 404) && modelIdx < models.length - 1) {
            modelIdx++;
            result = await requestImage(gw, models[modelIdx], prompt, slot);
          }
          if (!result.ok || !result.parsed) { failed++; lastFailure = result.detail ?? "failed"; dropAfterMismatch(); break; }
          const file = await toBytes(result.parsed).catch(() => null);
          if (!file) { failed++; lastFailure = "could not read image"; dropAfterMismatch(); break; }
          const path = `website-images/${site.user_id}/${site.id}/${crypto.randomUUID()}.${extensionForMime(file.mime)}`;
          const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file.bytes, { contentType: file.mime, upsert: false });
          if (upErr) { failed++; lastFailure = upErr.message; dropAfterMismatch(); break; }

          let verdict: VerifyResult = { match: null, reason: "" };
          if (opts.verify) verdict = await verifyImage(gw, verifyUrlFor(path), slot.subject, ctx);
          console.log(`[generate-site-images] guard ${slot.kind} attempt ${attempt + 1} -> ${verdict.match === null ? "unchecked" : verdict.match ? "match" : "MISMATCH: " + verdict.reason}`);
          // Asked to verify but got no verdict: keep the image, tell the owner.
          if (opts.verify && verdict.match === null) tally.unverified++;

          if (verdict.match === false) {
            await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
            lastReason = verdict.reason;
            if (attempt === 0) { prompt = reinforcePrompt(basePrompt, slot.subject, verdict.reason); retried = true; continue; }
            tally.dropped++;
            if (tally.examples.length < 3) tally.examples.push(`${kindLabel(slot.kind)}: showed ${lastReason || "something unrelated"}`);
            failed++; lastFailure = "no generated image matched your business";
            break;
          }
          await writeSlot(slot, optimizedImageUrl(Deno.env.get("SUPABASE_URL")!, BUCKET, path, slot.aspect));
          succeeded++;
          if (retried) {
            tally.replaced++;
            if (tally.examples.length < 3) tally.examples.push(`${kindLabel(slot.kind)}: first attempt showed ${lastReason || "something unrelated"}`);
          }
          break;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slots.length) }, worker));
    await writeChain;

    const skipped = slots.length - succeeded - failed;
    const update: Record<string, unknown> = { images_status: succeeded > 0 || slots.length === 0 ? "done" : "failed" };
    const { data: w } = await admin.from("websites").select("generation_notes").eq("id", site.id).maybeSingle();
    const notes: unknown[] = Array.isArray(w?.generation_notes) ? w.generation_notes : [];
    // Earlier image-guard notes are replaced by this run's, never accumulated.
    let nextNotes: unknown[] = withoutImageGuardNotes(notes);
    if (slots.length > 0 && succeeded === 0) {
      // A credits outage repeats on every retry: keep a single note instead of one per attempt.
      if (OUT_OF_CREDITS.test(lastFailure)) await openIncidentOnce(admin, PROVIDER_OUTAGE_KIND, OUTAGE_SUMMARY, { source: "generate-site-images", website_id: site.id });
      const base = OUT_OF_CREDITS.test(lastFailure) ? nextNotes.filter((n) => !(typeof n === "string" && n.startsWith(FAILURE_NOTE_PREFIX))) : nextNotes;
      nextNotes = [...base, `${FAILURE_NOTE_PREFIX} this time (${lastFailure || "no image returned"}), so decorative illustrations are shown instead.`];
    } else if (succeeded > 0) {
      // An earlier attempt's failure note no longer describes the site.
      nextNotes = nextNotes.filter((n) => !(typeof n === "string" && n.startsWith(FAILURE_NOTE_PREFIX)));
    }
    nextNotes = [...nextNotes, ...describeGuardTally(tally, site.name)];
    if (JSON.stringify(nextNotes) !== JSON.stringify(notes)) update.generation_notes = nextNotes;
    console.log(`[generate-site-images] ${site.id}: ${succeeded} ok, ${failed} failed, ${skipped} skipped of ${slots.length} slots`);
    await admin.from("websites").update(update).eq("id", site.id);
  } catch (e) {
    console.error("[generate-site-images] run failed", e);
    await admin.from("websites").update({ images_status: "failed" }).eq("id", site.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    // The backfill sweep (site-images-backfill-sweep) calls this with the
    // service-role key to give sites that predate image generation their
    // pictures; every other caller is the signed-in owner of the site.
    const isService = authHeader === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
    let userId: string | null = null;
    if (!isService) {
      const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
      userId = userData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const websiteId = typeof body?.website_id === "string" ? body.website_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(websiteId)) return json({ error: "website_id required" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: site } = await admin.from("websites")
      .select("id, user_id, name, tagline, prompt, theme, images_status, images_started_at").eq("id", websiteId).maybeSingle();
    if (!site || (!isService && site.user_id !== userId)) return json({ error: "Website not found" }, 404);

    if ((site.images_status === "pending" || site.images_status === "running") && site.images_started_at
      && Date.now() - new Date(site.images_started_at).getTime() < STALE_RUN_MS) {
      return json({ ok: true, status: "already_running" }, 202);
    }
    if (!isService) {
      const rate = await checkRateLimit(admin, userId!, "generate-site-images", 12, 3600);
      if (!rate.allowed) return json({ error: "rate_limited", message: "Too many image generations in the last hour. Try again later." }, 429);
    }

    const gw = pickAiGateway();
    if (!gw) {
      await admin.from("websites").update({ images_status: "failed" }).eq("id", site.id);
      return json({ error: "AI gateway not configured" }, 503);
    }

    await admin.from("websites").update({ images_status: "running", images_started_at: new Date().toISOString() }).eq("id", site.id);
    // verify (default on): the Relevance Guard's vision check on every finished
    // image. snapshotFirst: backfills (service role) keep a before-state.
    const work = run(admin, gw, { verify: body?.verify !== false, snapshotFirst: isService }, site);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;
    return json({ ok: true, status: "running" }, 202);
  } catch (e) {
    return json({ error: "internal_error", message: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
