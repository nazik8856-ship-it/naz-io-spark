// Run with: deno test supabase/functions/_shared/image-guard_test.ts
import {
  buildVerifyPrompt, businessSubject, describeGuardTally, emptyTally, IMAGE_NOTE_PREFIX, parseVerifyResponse,
  reinforcePrompt, subjectMatchesBusiness, withoutImageGuardNotes,
} from "./image-guard.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const cafe = { siteName: "Vienna Brew Café", tagline: "Specialty coffee and pastry in the 7th district", brief: "An aesthetic cafe in Vienna with specialty coffee, pastries and a cozy interior" };

Deno.test("the real failure: a space/desert/beach prompt for a Vienna café does NOT match the business", () => {
  assert(!subjectMatchesBusiness("a vast desert at dusk with a starry night sky", cafe));
  assert(!subjectMatchesBusiness("tropical beach, turquoise water, palm trees", cafe));
  assert(!subjectMatchesBusiness("astronaut floating above planet earth", cafe));
});

Deno.test("prompts about the business match (shares a meaningful word with name/tagline/brief)", () => {
  assert(subjectMatchesBusiness("latte art on a marble counter, specialty coffee", cafe));
  assert(subjectMatchesBusiness("fresh pastry in a display case", cafe));
  assert(subjectMatchesBusiness("a cozy corner of the cafe with morning light", cafe));
  assert(subjectMatchesBusiness("Vienna Brew Café -- Our cozy interior", cafe), "derived subjects start with the site name");
});

Deno.test("plural/singular are treated alike and photography words never count as a match", () => {
  assert(subjectMatchesBusiness("pastries on a tray", cafe));
  assert(!subjectMatchesBusiness("aerial photograph of desert dunes, golden hour, natural lighting", cafe), "photography words do not rescue an unrelated subject");
  assert(subjectMatchesBusiness("aerial photograph, golden hour, natural lighting, professional quality", cafe), "only photography words = nothing to judge");
});

Deno.test("nothing meaningful to judge -> assume fine (never rewrite on no evidence)", () => {
  assert(subjectMatchesBusiness("a b c", cafe));
  assert(subjectMatchesBusiness("desert", { siteName: "", brief: "" }));
});

Deno.test("unicode business words match (non-English brief)", () => {
  const ctx = { siteName: "Café Müller", brief: "Kaffeehaus mit Mehlspeisen und Frühstück in Wien" };
  assert(subjectMatchesBusiness("Frühstück mit Kaffee und Mehlspeisen", ctx));
  assert(!subjectMatchesBusiness("Wüste bei Sonnenuntergang", ctx));
});

Deno.test("businessSubject names the business and what it does, trimmed", () => {
  const s = businessSubject(cafe, "hero");
  assert(s.startsWith("Vienna Brew Café -- hero -- ") && s.includes("Specialty coffee"));
  const noTag = businessSubject({ siteName: "Ember", brief: "A bakery. We bake bread." }, "about");
  assertEquals(noTag, "Ember -- about -- A bakery");
});

Deno.test("verify prompt carries the site, the subject, the brief and the answer format", () => {
  const p = buildVerifyPrompt("latte art", cafe);
  for (const w of ["Vienna Brew Café", "latte art", "aesthetic cafe", '"match"', "beach or desert"]) assert(p.includes(w), w);
});

Deno.test("parseVerifyResponse: match true/false with reason; garbage and unparseable are null (fail open)", () => {
  const reply = (content: unknown) => ({ choices: [{ message: { content } }] });
  assertEquals(parseVerifyResponse(reply('{"match": true, "reason": "a latte on a counter"}')), { match: true, reason: "a latte on a counter" });
  assertEquals(parseVerifyResponse(reply('Sure! {"match": false, "reason": "a sandy beach"} hope that helps')), { match: false, reason: "a sandy beach" });
  assertEquals(parseVerifyResponse(reply("I cannot tell")).match, null);
  assertEquals(parseVerifyResponse(reply('{"match": "maybe"}')).match, null);
  assertEquals(parseVerifyResponse(reply("{broken")).match, null);
  assertEquals(parseVerifyResponse(null).match, null);
  assertEquals(parseVerifyResponse({}).match, null);
  assertEquals(parseVerifyResponse(reply('{"match": false, "reason": "' + "x".repeat(400) + '"}')).reason.length, 140);
});

Deno.test("reinforcePrompt feeds back why the first attempt failed", () => {
  const p = reinforcePrompt("Create one photo.", "latte art", "a sandy beach");
  assert(p.startsWith("Create one photo.") && p.includes("showed: a sandy beach") && p.includes("literally show: latte art"));
  assert(!reinforcePrompt("x", "y", "").includes("because"));
});

Deno.test("notes are specific, singular/plural correct, and silent when nothing happened", () => {
  assertEquals(describeGuardTally(emptyTally(), "Ember"), []);
  const t = { promptsRewritten: 1, replaced: 2, dropped: 1, examples: ["hero: showed a beach", "gallery: showed a desert"] };
  const notes = describeGuardTally(t, "Vienna Brew Café");
  assertEquals(notes.length, 3);
  assert(notes.every((n) => n.startsWith(IMAGE_NOTE_PREFIX)));
  assert(notes[0].includes("Rewrote 1 image description that had nothing to do with Vienna Brew Café"));
  assert(notes[1].includes("Replaced 2 generated images that didn't match") && notes[1].includes("hero: showed a beach; gallery: showed a desert"));
  assert(notes[2].includes("1 image still didn't match") && !notes[2].includes("hero: showed"), "examples are not repeated on the dropped line when replacements already listed them");
});

Deno.test("the dropped line carries the example when nothing was replaced", () => {
  const notes = describeGuardTally({ promptsRewritten: 0, replaced: 0, dropped: 1, examples: ["hero: showed a beach"] }, "Ember");
  assert(notes[0].includes("hero: showed a beach") && notes[0].includes("decorative illustration is kept"));
});

Deno.test("withoutImageGuardNotes removes only earlier image-guard notes", () => {
  const out = withoutImageGuardNotes(["Content flagged", `${IMAGE_NOTE_PREFIX}Replaced 1`, "Relevance Guard: Removed 1 testimonial", 42]);
  assertEquals(out, ["Content flagged", "Relevance Guard: Removed 1 testimonial", 42]);
});
