import { listAll, planRemovals, siteFolders, topFolders, type ListableStorage, type StorageEntry } from "./orphan-files.ts";

const sorted = (o: Record<string, string>) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b));
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const USER = "00000000-0000-0000-0000-0000000000a1";
const GONE_SITE = "11111111-1111-1111-1111-111111111111";   // new layout, site deleted
const LIVE_SITE = "22222222-2222-2222-2222-222222222222";   // new layout, site exists
const OLD_GONE = "33333333-3333-3333-3333-333333333333";    // old layout (under the user), site deleted
const OLD_LIVE = "44444444-4444-4444-4444-444444444444";    // old layout, site exists
const SHARED = "55555555-5555-5555-5555-555555555555";      // site deleted but a share link still shows it
const FRESH = "66666666-6666-6666-6666-666666666666";       // site deleted a minute ago
const DAY = 86_400_000, NOW = Date.parse("2026-11-05T12:00:00Z"), OLD = new Date(NOW - 10 * DAY).toISOString(), NEW = new Date(NOW - 60_000).toISOString();

/** A tiny bucket: path -> created_at for files; folders are implied by the paths. */
function bucket(files: Record<string, string>): ListableStorage & { listed: string[] } {
  const listed: string[] = [];
  return {
    listed,
    list: async (path, { limit, offset }) => {
      listed.push(path);
      const prefix = path ? path + "/" : "";
      const seen = new Map<string, StorageEntry>();
      for (const [p, at] of Object.entries(files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length), head = rest.split("/")[0];
        if (!seen.has(head)) seen.set(head, rest.includes("/") ? { name: head, id: null } : { name: head, id: "obj-" + p, created_at: at });
      }
      return { data: [...seen.values()].slice(offset, offset + limit), error: null };
    },
  };
}

const images = bucket({
  [`website-images/${GONE_SITE}/a.png`]: OLD, [`website-images/${GONE_SITE}/uploads/b.webp`]: OLD,
  [`website-images/${LIVE_SITE}/c.png`]: OLD,
  [`website-images/${USER}/${OLD_GONE}/d.png`]: OLD, [`website-images/${USER}/${OLD_GONE}/uploads/e.png`]: OLD,
  [`website-images/${USER}/${OLD_LIVE}/f.png`]: OLD,
  [`website-images/${SHARED}/g.png`]: OLD,
  [`website-images/${FRESH}/h.png`]: NEW,
  "website-images/not-an-id/x.png": OLD,
});

Deno.test("siteFolders: finds both layouts, the uploads folder stays part of its site, and skips what is not an id", async () => {
  const f = await siteFolders(images);
  assertEquals(f.map((x) => x.folder).sort(), [
    `website-images/${USER}/${OLD_GONE}`, `website-images/${USER}/${OLD_LIVE}`,
    `website-images/${FRESH}`, `website-images/${GONE_SITE}`, `website-images/${LIVE_SITE}`, `website-images/${SHARED}`,
  ].sort());
});

Deno.test("planRemovals: only files of a site that is gone, not shared, and not new are removed (both layouts, uploads too)", async () => {
  const folders = await siteFolders(images);
  const plan = await planRemovals(images, folders, {
    exist: async (ids) => new Set(ids.filter((i) => i === LIVE_SITE || i === OLD_LIVE)),
    inUse: async (id) => id === SHARED,
    graceMs: DAY, now: NOW,
  });
  const verdicts = Object.fromEntries(plan.map((p) => [p.id, p.verdict]));
  assertEquals(sorted(verdicts), sorted({ [OLD_GONE]: "remove", [OLD_LIVE]: "keep_exists", [FRESH]: "keep_too_new", [GONE_SITE]: "remove", [LIVE_SITE]: "keep_exists", [SHARED]: "keep_in_use" }));
  assertEquals(plan.filter((p) => p.verdict === "remove").flatMap((p) => p.files).sort(), [
    `website-images/${GONE_SITE}/a.png`, `website-images/${GONE_SITE}/uploads/b.webp`,
    `website-images/${USER}/${OLD_GONE}/d.png`, `website-images/${USER}/${OLD_GONE}/uploads/e.png`,
  ].sort());
});

Deno.test("planRemovals: a lookup that fails stops the plan instead of guessing", async () => {
  const folders = await siteFolders(images);
  let threw = false;
  try { await planRemovals(images, folders, { exist: async () => { throw new Error("db down"); }, graceMs: DAY, now: NOW }); } catch { threw = true; }
  assertEquals(threw, true);
});

Deno.test("planRemovals: the existence check is asked in batches of at most 100 ids", async () => {
  const many = bucket(Object.fromEntries(Array.from({ length: 230 }, (_, i) => [`website-images/${(1000 + i).toString(16).padStart(8, "0")}-0000-0000-0000-000000000000/p.png`, OLD])));
  const folders = await siteFolders(many);
  assertEquals(folders.length, 230);
  const sizes: number[] = [];
  await planRemovals(many, folders, { exist: async (ids) => { sizes.push(ids.length); return new Set(ids); }, graceMs: DAY, now: NOW });
  assertEquals(sizes, [100, 100, 30]);
});

Deno.test("topFolders + planRemovals: a user's private files go only when the account is gone and the files are old", async () => {
  const GONE_USER = "77777777-7777-7777-7777-777777777777", LIVE_USER = "88888888-8888-8888-8888-888888888888", NEW_GONE = "99999999-9999-9999-9999-999999999999";
  const priv = bucket({
    [`${GONE_USER}/prompt-inputs/a.webp`]: OLD, [`${LIVE_USER}/prompt-inputs/b.webp`]: OLD, [`${NEW_GONE}/prompt-inputs/c.webp`]: NEW, "readme.txt": OLD,
  });
  const plan = await planRemovals(priv, await topFolders(priv), { exist: async (ids) => new Set(ids.filter((i) => i === LIVE_USER)), graceMs: 7 * DAY, now: NOW });
  assertEquals(sorted(Object.fromEntries(plan.map((p) => [p.id, p.verdict]))), sorted({ [GONE_USER]: "remove", [LIVE_USER]: "keep_exists", [NEW_GONE]: "keep_too_new" }));
  assertEquals(plan.find((p) => p.id === GONE_USER)!.files, [`${GONE_USER}/prompt-inputs/a.webp`]);
});

Deno.test("listAll: pages through a long folder", async () => {
  const b = bucket(Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`f/${i}.png`, OLD])));
  assertEquals((await listAll(b, "f")).length, 250);
});
