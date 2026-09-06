// Real tests for the deterministic retrieval + template synthesis engine
// (item 176).
//
// Run with: deno test --allow-none supabase/functions/_shared/response-synthesis_test.ts
import { synthesizeAnswer } from "./response-synthesis.ts";
import type { ResponseContextEntry } from "./response-context.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("synthesizeAnswer: no entries returns null", () => {
  assertEquals(synthesizeAnswer([]), null);
});

Deno.test("synthesizeAnswer: a single entry is returned verbatim", () => {
  const entries: ResponseContextEntry[] = [{ id: "e1", entry_text: "Refunds take 5-7 business days." }];
  const result = synthesizeAnswer(entries);
  assertEquals(result?.text, "Refunds take 5-7 business days.");
  assertEquals(result?.usedEntries, entries);
});

Deno.test("synthesizeAnswer: two genuinely different entries are stitched together", () => {
  const entries: ResponseContextEntry[] = [
    { id: "e1", entry_text: "Refunds take 5-7 business days." },
    { id: "e2", entry_text: "We only ship within the continental US." },
  ];
  const result = synthesizeAnswer(entries);
  assert(result !== null);
  assert(result!.text.includes("Refunds take 5-7 business days."));
  assert(result!.text.includes("Additionally, we only ship within the continental US."));
  assertEquals(result!.usedEntries.length, 2);
});

Deno.test("synthesizeAnswer: near-duplicate entries collapse to the higher-ranked one", () => {
  const entries: ResponseContextEntry[] = [
    { id: "e1", entry_text: "Refunds are processed within 5 to 7 business days of receipt." },
    { id: "e2", entry_text: "Refunds are processed within 5 to 7 business days after we receive the item." },
  ];
  const result = synthesizeAnswer(entries);
  assertEquals(result?.usedEntries.length, 1);
  assertEquals(result?.usedEntries[0].id, "e1");
});

Deno.test("synthesizeAnswer: caps at 3 entries even when more are given", () => {
  const entries: ResponseContextEntry[] = [
    { id: "e1", entry_text: "Refunds take 5-7 business days." },
    { id: "e2", entry_text: "We ship worldwide except restricted countries." },
    { id: "e3", entry_text: "Support hours are 9-5 ET on weekdays." },
    { id: "e4", entry_text: "Gift cards never expire." },
  ];
  const result = synthesizeAnswer(entries);
  assertEquals(result?.usedEntries.length, 3);
  assert(!result!.text.includes("Gift cards never expire."));
});

Deno.test("synthesizeAnswer: connective phrasing lowercases a genuine leading capital but not an acronym", () => {
  const entries: ResponseContextEntry[] = [
    { id: "e1", entry_text: "Refunds take 5-7 business days." },
    { id: "e2", entry_text: "USB-C chargers are included with every order." },
  ];
  const result = synthesizeAnswer(entries);
  assert(result!.text.includes("Additionally, USB-C chargers are included with every order."));
});
