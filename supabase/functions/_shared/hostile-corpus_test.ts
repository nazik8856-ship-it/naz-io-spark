import { HOSTILE_CASES, MAX_CALLS_PER_RUN, PROBE_BATCHES, PROBE_SKIP, batchOf, describeFetchError, judge, p95, probeJobs, withRetry, type Attempt } from "./hostile-corpus.ts";
import { FUNCTION_ACCESS } from "./function-access.ts";
import { readJson } from "./input.ts";
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

for (const c of HOSTILE_CASES) {
  Deno.test(`hostile case through the shared reader: ${c.name}`, async () => {
    const r = await readJson(new Request("https://x.test/f", { method: "POST", body: c.body }));
    if (c.readerStatus) { assert(!r.ok, `${c.name} must be refused`); assertEquals(r.status, c.readerStatus, c.name); }
    else {
      assert(r.ok, `${c.name} is a harmless body the reader cleans, not refuses`);
      const text = JSON.stringify(r.value);
      // the reader removes NUL and other control characters from every string; bidi marks are removed where text is used (cleanText)
      assert(!text.includes("\\u0000") && !text.includes("\u0000"), "NUL must be gone");
      assertEquals(({} as Record<string, unknown>).admin, undefined);
    }
  });
}

Deno.test("every case is small enough to send and none is a valid paid request (no plain-text prompt)", () => {
  for (const c of HOSTILE_CASES) {
    assert(c.body.length < 400 * 1024, `${c.name} too big to send`);
    try { const v = JSON.parse(c.body); assert(typeof v?.prompt !== "string" || v.prompt.length > 256 * 1024, `${c.name} carries a usable prompt`); } catch { /* not JSON: fine */ }
  }
});

Deno.test("judge: calm refusals pass; 500s, time-outs, leaks and accepted must-refuse cases fail", () => {
  const must = HOSTILE_CASES.find((c) => c.mustRefuse)!, soft = HOSTILE_CASES.find((c) => !c.mustRefuse)!;
  for (const s of [400, 401, 403, 404, 405, 410, 413, 429]) assertEquals(judge(must, s, '{"error":"nope"}', 50, 15000), null, String(s));
  assertEquals(judge(soft, 200, '{"questions":[]}', 50, 15000), null);
  assert(judge(must, 200, "{}", 50, 15000)!.includes("must refuse"));
  assert(judge(must, 500, "{}", 50, 15000)!.includes("500"));
  assert(judge(must, 502, "", 50, 15000)!.includes("502"));
  assert(judge(must, null, "", 15000, 15000)!.includes("time limit"));
  assert(judge(must, null, "", 20, 15000)!.includes("network"));
  assert(judge(must, 400, "Error: boom\n    at handler (file:///src/index.ts:12:5)", 50, 15000)!.includes("stack trace"));
  assert(judge(soft, 200, '{"k":"sk-abcdefghijklmnopqrstuvwxyz123"}', 50, 15000)!.includes("key"));
  assert(judge(soft, 200, "service_role", 50, 15000)!.includes("key"));
});

Deno.test("p95", () => {
  assertEquals(p95([]), 0);
  assertEquals(p95(Array.from({ length: 100 }, (_, i) => i + 1)), 95);
  assertEquals(p95([7]), 7);
});

Deno.test("withRetry: a dropped connection is tried again; an answer or a time-out is final", async () => {
  const noSleep = () => Promise.resolve();
  const seq = (list: Attempt[]) => { let i = 0; return () => Promise.resolve(list[Math.min(i++, list.length - 1)]); };
  const dropped: Attempt = { status: null, text: "", ms: 20, error: "TypeError: connection reset" };
  const ok: Attempt = { status: 400, text: "{}", ms: 30 };
  let r = await withRetry(seq([dropped, ok]), 15000, 3, 0, noSleep);
  assertEquals([r.status, r.tries], [400, 2]);
  r = await withRetry(seq([dropped, dropped, ok]), 15000, 2, 0, noSleep);
  assertEquals([r.status, r.tries, r.error], [null, 2, "TypeError: connection reset"]);
  r = await withRetry(seq([{ ...dropped, budget: true }, ok]), 15000, 2, 0, noSleep);
  assertEquals([r.status, r.tries], [null, 1]);
  r = await withRetry(seq([{ status: null, text: "", ms: 15000 }, ok]), 15000, 3, 0, noSleep);
  assertEquals([r.status, r.tries], [null, 1]);
  r = await withRetry(seq([{ status: 500, text: "", ms: 10 }, ok]), 15000, 3, 0, noSleep);
  assertEquals([r.status, r.tries], [500, 1]);
});

Deno.test("describeFetchError: short, one line, no keys", () => {
  const d = describeFetchError(new TypeError("error sending request\nBearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcdefghijklmnop"));
  assert(d.startsWith("TypeError: error sending request"), d);
  assert(!d.includes("\n") && !d.includes("eyJhbGci"), d);
  assert(describeFetchError("x".repeat(500)).length <= 160);
});

Deno.test("probe plan: every call of a full probe is in exactly one batch, and no batch goes over the per-run call budget", () => {
  const all = probeJobs(FUNCTION_ACCESS, PROBE_SKIP);
  const publicFns = Object.entries(FUNCTION_ACCESS).filter(([fn, a]) => !PROBE_SKIP.has(fn) && (a.access === "public" || a.access === "api_key")).length;
  const protectedFns = Object.entries(FUNCTION_ACCESS).filter(([fn, a]) => !PROBE_SKIP.has(fn) && (a.access === "user" || a.access === "system")).length;
  assertEquals(all.length, publicFns * HOSTILE_CASES.length + protectedFns);
  let seen = 0;
  for (let b = 0; b < PROBE_BATCHES; b++) {
    const mine = batchOf(all, b, PROBE_BATCHES);
    assert(mine.length > 0 && mine.length <= MAX_CALLS_PER_RUN, `batch ${b} has ${mine.length} calls; raise PROBE_BATCHES (and add the batch to the schedule)`);
    seen += mine.length;
  }
  assertEquals(seen, all.length);
  assert(!all.some((j) => PROBE_SKIP.has(j.fn)));
  assert(all.filter((j) => j.kind === "stranger").every((j) => j.hostile === null));
});
