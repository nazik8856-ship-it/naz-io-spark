// Run with: deno test --allow-env supabase/functions/_shared/website-restore_test.ts
// Data at rest (security task 1): restoring a saved website version runs in code (the snapshots are encrypted), with the user's client.
import { restoreWebsiteVersion } from "./website-restore.ts";
import { withFieldEncryption } from "./encrypted-db.ts";
import { importFieldKeys, toB64 } from "./field-crypto.ts";
import { createClient, reset, rpcCalls, state, table } from "../../../tests/outer-control-engine/fake-supabase.ts";

function assert(ok: unknown, m: string) { if (!ok) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const KEYS = (await importFieldKeys(toB64(new Uint8Array(32).fill(7))))!;
const SITE = "11111111-1111-1111-1111-111111111111";

async function setup() {
  reset();
  const db = withFieldEncryption(createClient("", ""), KEYS);
  await db.from("websites").insert({ id: SITE, user_id: "u1", name: "New name", title: "New", tagline: "now", theme: { c: "red" }, prompt: "current brief" });
  table("website_pages").push({ id: "p1", website_id: SITE, slug: "home", title: "Home now", seo_description: null, sections: [], order_index: 0 });
  const { data: v } = await db.from("website_versions").insert({
    user_id: "u1", website_id: SITE, label: "v1",
    website_snapshot: { name: "Old name", title: "Old", tagline: null, theme: { c: "blue" }, prompt: "old brief" },
    pages_snapshot: [{ slug: "home", title: "Home then", sections: [{ t: "hero" }], order_index: 0, extra: "dropped" }, { slug: "about", title: "About", order_index: 1 }],
  }).select("id").single();
  state.rpc.replace_website_pages = (args: { _website_id: string; _pages: Record<string, unknown>[] }) => {
    const rows = table("website_pages");
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].website_id === args._website_id) rows.splice(i, 1);
    for (const p of args._pages) rows.push({ website_id: args._website_id, ...p });
    return null;
  };
  return { db, versionId: v.id as string };
}

Deno.test("restore: the current site is saved first, then the site and pages come back from the snapshot", async () => {
  const { db, versionId } = await setup();
  const r = await restoreWebsiteVersion(db, versionId);
  assertEquals(r, { data: SITE, error: null });
  const { data: site } = await db.from("websites").select("name, title, tagline, theme, prompt").eq("id", SITE).single();
  assertEquals([site.name, site.title, site.tagline, site.theme, site.prompt], ["Old name", "Old", null, { c: "blue" }, "old brief"]);
  assertEquals(table("website_pages").map((p) => [p.slug, p.title]), [["home", "Home then"], ["about", "About"]]);
  assert(!("extra" in table("website_pages")[0]), "only the page fields are restored");
  const call = rpcCalls.find((c) => c.name === "replace_website_pages")!;
  assertEquals(call.args._pages[1], { slug: "about", title: "About", seo_description: null, sections: null, order_index: 1 });
  const { data: before } = await db.from("website_versions").select("label, website_snapshot, pages_snapshot").eq("label", "Before restore").single();
  assertEquals([before.website_snapshot.prompt, before.pages_snapshot[0].title], ["current brief", "Home now"], "what was there is kept as a version");
  assert(!JSON.stringify(table("website_versions")).includes("current brief") && !JSON.stringify(table("websites")).includes("old brief"), "snapshots and the brief are stored encrypted");
});

Deno.test("restore: an unknown version or a missing site changes nothing", async () => {
  const { db, versionId } = await setup();
  assertEquals((await restoreWebsiteVersion(db, "99999999-9999-9999-9999-999999999999")).error?.message, "Version not found");
  table("websites").length = 0;
  assertEquals((await restoreWebsiteVersion(db, versionId)).error?.message, "Website no longer exists");
  assertEquals(table("website_versions").length, 1, "no Before restore version was written");
  assertEquals(rpcCalls.filter((c) => c.name === "replace_website_pages").length, 0);
});

Deno.test("restore: if the pages can not be replaced the error is returned (the database call is all or nothing)", async () => {
  const { db, versionId } = await setup();
  state.rpc.replace_website_pages = () => { throw new Error("too many pages"); };
  assertEquals((await restoreWebsiteVersion(db, versionId)).error?.message, "too many pages");
  assertEquals(table("website_pages").map((p) => p.title), ["Home now"], "the pages are untouched");
});
