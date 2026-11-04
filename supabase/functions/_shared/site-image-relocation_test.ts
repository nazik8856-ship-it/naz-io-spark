import { destinationFor, legacyFolders, prefixes, relocateSite, type CopyStorage, type RelocationDb } from "./site-image-relocation.ts";
import type { StorageEntry } from "./orphan-files.ts";
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const OWNER = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const OLD = `website-images/${OWNER}/${SITE}`;

/** An in-memory bucket: paths of files; folders are implied by the paths. */
function bucket(paths: string[], fail: { copy?: RegExp; remove?: boolean } = {}) {
  const files = new Set(paths);
  const storage: CopyStorage & { files: Set<string>; copies: string[] } = {
    files, copies: [],
    list: async (path: string) => {
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, StorageEntry>();
      for (const f of files) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        names.set(head, tail.length ? { name: head, id: null } : { name: head, id: "x", created_at: "2026-01-01T00:00:00Z" });
      }
      return { data: [...names.values()], error: null };
    },
    copy: async (from: string, to: string) => {
      if (fail.copy?.test(from)) return { error: { message: "network error" } };
      if (files.has(to)) return { error: { message: "The resource already exists" } };
      files.add(to); storage.copies.push(to);
      return { error: null };
    },
    remove: async (ps: string[]) => {
      if (fail.remove) return { error: { message: "nope" } };
      for (const p of ps) files.delete(p);
      return { error: null };
    },
  };
  return storage;
}

function db(opts: { owner?: string | null; left?: number | null; rewriteThrows?: boolean } = {}) {
  const calls: string[] = [];
  const d: RelocationDb & { calls: string[] } = {
    calls,
    ownerOf: async () => (opts.owner === undefined ? OWNER : opts.owner),
    rewrite: async (site, from, to) => { if (opts.rewriteThrows) throw new Error("db down"); calls.push(`rewrite ${site} ${from} ${to}`); return 3; },
    refsLeft: async () => (opts.left === undefined ? 0 : opts.left),
  };
  return d;
}

const legacy = { owner: OWNER, site: SITE, folder: OLD };

Deno.test("legacyFolders: only website-images/<id>/<id> folders", () => {
  const found = legacyFolders([
    { id: SITE, folder: OLD },
    { id: OTHER, folder: `website-images/${OTHER}` },
    { id: SITE, folder: `website-images/${OWNER}/not-an-id` },
    { id: SITE, folder: `elsewhere/${OWNER}/${SITE}` },
  ]);
  assertEquals(found, [legacy]);
});

Deno.test("prefixes and destinations keep everything below the site folder and nothing else", () => {
  assertEquals(prefixes(legacy), { from: `${OLD}/`, to: `website-images/${SITE}/` });
  assertEquals(destinationFor(`${OLD}/a.webp`, legacy), `website-images/${SITE}/a.webp`);
  assertEquals(destinationFor(`${OLD}/uploads/b.png`, legacy), `website-images/${SITE}/uploads/b.png`);
  assertEquals(destinationFor(`website-images/${OWNER}/${OTHER}/a.webp`, legacy), null);
  assertEquals(destinationFor(`${OLD}/`, legacy), null);
  assertEquals(destinationFor(`${OLD}x/a.webp`, legacy), null);
});

Deno.test("relocateSite: copies, rewrites, then removes the old files", async () => {
  const s = bucket([`${OLD}/a.webp`, `${OLD}/uploads/b.png`, `website-images/${OTHER}/c.webp`]);
  const d = db();
  const r = await relocateSite(s, d, legacy);
  assertEquals(r, { site: SITE, status: "moved", files: 2, copied: 2, removed: 2, rows_rewritten: 3 });
  assertEquals([...s.files].sort(), [`website-images/${OTHER}/c.webp`, `website-images/${SITE}/a.webp`, `website-images/${SITE}/uploads/b.png`].sort());
  assertEquals(d.calls, [`rewrite ${SITE} ${OLD}/ website-images/${SITE}/`]);
});

Deno.test("relocateSite: a copy left by an interrupted run counts as done", async () => {
  const s = bucket([`${OLD}/a.webp`, `website-images/${SITE}/a.webp`]);
  const r = await relocateSite(s, db(), legacy);
  assertEquals([r.status, r.copied, r.removed], ["moved", 1, 1]);
  assertEquals([...s.files], [`website-images/${SITE}/a.webp`]);
});

Deno.test("relocateSite: a failed copy changes no address and removes nothing", async () => {
  const s = bucket([`${OLD}/a.webp`, `${OLD}/b.webp`], { copy: /b\.webp$/ });
  const d = db();
  const r = await relocateSite(s, d, legacy);
  assertEquals(r.status, "copy_failed");
  assertEquals(d.calls, []);
  assert(s.files.has(`${OLD}/a.webp`) && s.files.has(`${OLD}/b.webp`), "old files kept");
});

Deno.test("relocateSite: old files stay while anything still points at them (or the count is unsure)", async () => {
  for (const left of [2, null]) {
    const s = bucket([`${OLD}/a.webp`]);
    const r = await relocateSite(s, db({ left }), legacy);
    assertEquals(r.status, "refs_left");
    assert(s.files.has(`${OLD}/a.webp`), "old file kept");
  }
});

Deno.test("relocateSite: a failed rewrite stops before removing", async () => {
  const s = bucket([`${OLD}/a.webp`]);
  let threw = false;
  try { await relocateSite(s, db({ rewriteThrows: true }), legacy); } catch { threw = true; }
  assert(threw, "the error reaches the sweep");
  assert(s.files.has(`${OLD}/a.webp`), "old file kept");
});

Deno.test("relocateSite: a deleted site or another owner's folder is left alone", async () => {
  for (const [owner, status] of [[null, "site_missing"], [OTHER, "owner_mismatch"]] as const) {
    const s = bucket([`${OLD}/a.webp`]);
    const r = await relocateSite(s, db({ owner }), legacy);
    assertEquals(r.status, status);
    assertEquals(s.copies, []);
    assert(s.files.has(`${OLD}/a.webp`));
  }
});

Deno.test("relocateSite: dry run only counts", async () => {
  const s = bucket([`${OLD}/a.webp`, `${OLD}/uploads/b.png`]);
  const d = db();
  const r = await relocateSite(s, d, legacy, { dryRun: true });
  assertEquals([r.status, r.files, r.copied], ["would_move", 2, 0]);
  assertEquals(d.calls, []);
  assertEquals(s.copies, []);
});

Deno.test("relocateSite: a failed removal is reported (the files are already copied and every address rewritten)", async () => {
  const s = bucket([`${OLD}/a.webp`], { remove: true });
  const r = await relocateSite(s, db(), legacy);
  assertEquals([r.status, r.copied, r.removed], ["remove_failed", 1, 0]);
});
