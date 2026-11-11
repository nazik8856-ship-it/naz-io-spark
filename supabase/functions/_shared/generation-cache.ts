// GAP 8 (Speed & Reliability Layer): caches a compiled manifest for an
// IDENTICAL repeated generation request (a double-submit, or a retry
// after a network blip) so the expensive AI call(s) -- generation, plus
// GAP 7's critique-and-revise -- are skipped on a hit. Deliberately NOT
// a cache of the final, gated manifest: a caller still runs every
// deterministic pre-save gate fresh on top of what this returns, every
// time, so a rule added since the cached entry was written is still
// enforced. Short TTL (see GENERATION_CACHE_TTL_MINUTES) -- long enough
// to catch an accidental duplicate submit, short enough that a genuine
// edit minutes later always regenerates for real.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { sha256Hex } from "./api-key-auth.ts";

export const GENERATION_CACHE_TTL_MINUTES = 10;

/** Pure -- stable regardless of key insertion order, so two requests with the same fields in a different order still hash identically. */
export async function generationCacheKeyFor(input: Record<string, unknown>): Promise<string> {
  const sorted = Object.keys(input).sort().reduce((acc, k) => {
    acc[k] = input[k];
    return acc;
  }, {} as Record<string, unknown>);
  return await sha256Hex(JSON.stringify(sorted));
}

/** Never throws -- a lookup failure just means "no cache hit," never blocks a real generation. */
export async function findCachedGeneration<T>(
  admin: SupabaseClient,
  userId: string,
  kind: "agent" | "website",
  cacheKey: string,
): Promise<T | null> {
  try {
    const { data } = await admin
      .from("generation_cache")
      .select("manifest")
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    return (data as { manifest: T } | null)?.manifest ?? null;
  } catch {
    return null;
  }
}

/** Best-effort -- storing a cache entry must never break a generation that already succeeded. Upserts so a retried request after the first write doesn't collide on the unique (user_id, kind, cache_key) index. */
export async function storeCachedGeneration(
  admin: SupabaseClient,
  userId: string,
  kind: "agent" | "website",
  cacheKey: string,
  manifest: unknown,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + GENERATION_CACHE_TTL_MINUTES * 60 * 1000).toISOString();
    // The manifest is stored encrypted and bound to its row id, so an existing entry is updated by id (an upsert on the key would
    // seal it for a new id that the database then discards).
    const { data: existing } = await admin.from("generation_cache").select("id")
      .eq("user_id", userId).eq("kind", kind).eq("cache_key", cacheKey).maybeSingle();
    if (existing?.id) {
      await admin.from("generation_cache").update({ manifest, expires_at: expiresAt }).eq("id", existing.id);
    } else {
      await admin.from("generation_cache").insert({ user_id: userId, kind, cache_key: cacheKey, manifest, expires_at: expiresAt });
    }
  } catch { /* caching must never break a real generation that already succeeded */ }
}
