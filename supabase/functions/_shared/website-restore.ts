// Restoring a website to a saved version (data at rest, security task 1). The versions' snapshots and the website's brief (prompt)
// are stored encrypted, so the database can not restore them itself any more (restore_website_version read the snapshot in SQL).
// encrypted-write does it instead, with the signed-in user's encrypting client, so row level security decides exactly as before:
//   1. the current site and pages are saved as a "Before restore" version (encrypted on write), as the database function did;
//   2. the site's name, title, tagline, theme and brief are set from the snapshot (the brief encrypted on write);
//   3. the pages are replaced in one database call (replace_website_pages), so a failure never leaves the site without pages.
// deno-lint-ignore no-explicit-any
type Db = any;
type Result = { data: unknown; error: { message: string; code?: string } | null };

const fail = (message: string): Result => ({ data: null, error: { message } });
const PAGE_FIELDS = ["slug", "title", "seo_description", "sections", "order_index"] as const;

export async function restoreWebsiteVersion(db: Db, versionId: string): Promise<Result> {
  const { data: v, error: vErr } = await db.from("website_versions")
    .select("id, website_id, user_id, website_snapshot, pages_snapshot").eq("id", versionId).maybeSingle();
  if (vErr) return { data: null, error: { message: vErr.message, code: vErr.code } };
  if (!v) return fail("Version not found");

  const { data: site, error: sErr } = await db.from("websites").select("*").eq("id", v.website_id).maybeSingle();
  if (sErr) return { data: null, error: { message: sErr.message, code: sErr.code } };
  if (!site) return fail("Website no longer exists");
  const { data: pages, error: pErr } = await db.from("website_pages")
    .select("slug, title, seo_description, sections, order_index").eq("website_id", v.website_id).order("order_index", { ascending: true });
  if (pErr) return { data: null, error: { message: pErr.message, code: pErr.code } };

  const { error: bErr } = await db.from("website_versions").insert({
    website_id: v.website_id, user_id: v.user_id, label: "Before restore", website_snapshot: site, pages_snapshot: pages ?? [],
  });
  if (bErr) return { data: null, error: { message: bErr.message, code: bErr.code } };

  const snap = (v.website_snapshot && typeof v.website_snapshot === "object" ? v.website_snapshot : {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { tagline: snap.tagline ?? null };
  for (const k of ["name", "title", "theme", "prompt"]) if (snap[k] !== undefined && snap[k] !== null) patch[k] = snap[k];
  const { error: uErr } = await db.from("websites").update(patch).eq("id", v.website_id);
  if (uErr) return { data: null, error: { message: uErr.message, code: uErr.code } };

  const restored = (Array.isArray(v.pages_snapshot) ? v.pages_snapshot : []).map((p: Record<string, unknown>) =>
    Object.fromEntries(PAGE_FIELDS.map((f) => [f, p?.[f] ?? null])));
  const { error: rErr } = await db.rpc("replace_website_pages", { _website_id: v.website_id, _pages: restored });
  if (rErr) return { data: null, error: { message: rErr.message, code: rErr.code } };
  return { data: v.website_id, error: null };
}
