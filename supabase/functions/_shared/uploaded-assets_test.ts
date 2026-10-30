// Run with: deno test --allow-env supabase/functions/_shared/uploaded-assets_test.ts
// User & data isolation: attached files are private signed links; a generated site publishes only the ones it places, and only
// the user's own.
import { createUploadAliases, publishUploadsInPages, publishedPath, signedUploadPattern } from "./uploaded-assets.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const BASE = "https://proj.supabase.co";
const ME = "93c45347-514d-4837-98d6-02221bc21da8", OTHER = "0d8544c1-24c8-4c41-8675-6277cc1e3449", SITE = "3819270b-373c-47f2-8d58-104680998a9b";
const signed = (path: string) => `${BASE}/storage/v1/object/sign/user-uploads/${path}?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJ4In0.sig-_~`;

function fakeAdmin(failWith?: string) {
  const copies: { from: string; to: string; bucket?: string }[] = [];
  return { copies, storage: { from: (_b: string) => ({ copy: async (from: string, to: string, o?: { destinationBucket?: string }) => {
    copies.push({ from, to, bucket: o?.destinationBucket });
    return { error: failWith ? { message: failWith } : null };
  } }) } };
}

Deno.test("signed upload links become short stand-ins; the real link is kept for the AI to see the image", () => {
  const a = createUploadAliases(BASE);
  const link = signed(`${ME}/prompt-inputs/1cf0-car.webp`);
  const text = a.text(`Use this photo: ${link} in the hero. Same photo again: ${link}.`);
  assertEquals(text, "Use this photo: https://uploads.nazai.invalid/1/1cf0-car.webp in the hero. Same photo again: https://uploads.nazai.invalid/1/1cf0-car.webp.");
  assertEquals(a.real("https://uploads.nazai.invalid/1/1cf0-car.webp"), link);
  assertEquals(a.real("https://example.com/x.png"), "https://example.com/x.png", "other links are left alone");
  assertEquals(a.text("public https://proj.supabase.co/storage/v1/object/public/mission-assets/x.png"), "public https://proj.supabase.co/storage/v1/object/public/mission-assets/x.png");
  assertEquals(signedUploadPattern(BASE).test(link), true);
});

Deno.test("saving pages publishes the uploads they place, and only those", async () => {
  const a = createUploadAliases(BASE);
  const used = a.text(signed(`${ME}/prompt-inputs/1cf0-car.webp`));
  a.text(signed(`${ME}/prompt-inputs/2bb1-passport.jpg`)); // attached as a reference, never placed in the site
  const admin = fakeAdmin();
  const rows = [{ website_id: SITE, sections: [{ type: "hero", asset_url: used }] }];
  const out = await publishUploadsInPages(admin, BASE, a, ME, SITE, rows);
  const publicUrl = `${BASE}/storage/v1/object/public/mission-assets/website-images/${ME}/${SITE}/uploads/1cf0-car.webp`;
  assertEquals(out.rows[0].sections[0].asset_url, publicUrl);
  assertEquals(admin.copies, [{ from: `${ME}/prompt-inputs/1cf0-car.webp`, to: publishedPath(ME, SITE, `${ME}/prompt-inputs/1cf0-car.webp`), bucket: "mission-assets" }]);
  assertEquals(out.published, [`${ME}/prompt-inputs/1cf0-car.webp`]);
  // What goes back to the browser: the published image as its public copy, the reference photo as its (private) signed link.
  const reply = a.restore(JSON.stringify({ hero: used, ref: "https://uploads.nazai.invalid/2/2bb1-passport.jpg" }));
  assertEquals(JSON.parse(reply), { hero: publicUrl, ref: signed(`${ME}/prompt-inputs/2bb1-passport.jpg`) });
});

Deno.test("another account's upload is never published, even with a valid link", async () => {
  const a = createUploadAliases(BASE);
  const theirs = a.text(signed(`${OTHER}/prompt-inputs/9f9f-photo.jpg`));
  const admin = fakeAdmin();
  const out = await publishUploadsInPages(admin, BASE, a, ME, SITE, [{ sections: [{ asset_url: theirs }] }]);
  assertEquals(admin.copies, [], "nothing copied");
  assertEquals(out.rows[0].sections[0].asset_url, "", "the page does not keep a link to it");
  assertEquals(out.refused, [`${OTHER}/prompt-inputs/9f9f-photo.jpg`]);
});

Deno.test("an image already published for this site is reused; a failed copy leaves no link that would stop working", async () => {
  const a = createUploadAliases(BASE);
  const used = a.text(signed(`${ME}/prompt-inputs/1cf0-car.webp`));
  const again = await publishUploadsInPages(fakeAdmin("The resource already exists"), BASE, a, ME, SITE, [{ u: used }]);
  assertEquals(again.rows[0].u.endsWith("/uploads/1cf0-car.webp"), true);
  const b = createUploadAliases(BASE);
  const failing = await publishUploadsInPages(fakeAdmin("storage unavailable"), BASE, b, ME, SITE, [{ u: b.text(signed(`${ME}/x/a.png`)) }]);
  assertEquals(failing.rows[0].u, "");
});
