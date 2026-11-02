import { readJson, parseBody, readQuery, jsonDepth, DEFAULT_MAX_BYTES } from "./input.ts";
import { cleanText, safeFileName, clip, scrubString } from "./clean-text.ts";
import { text, uuid, oneOf, int, array, object, optional, record, url, withDefault } from "./schema.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

const post = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("https://x.test/f", { method: "POST", body, headers });

Deno.test("readJson: a normal body is returned as it was sent", async () => {
  const r = await readJson(post(JSON.stringify({ prompt: "hi", n: 3, tags: ["a"] })));
  assert(r.ok); assertEquals(r.value, { prompt: "hi", n: 3, tags: ["a"] });
});

Deno.test("readJson: an empty body is {} (as `req.json().catch(() => ({}))` gave), unless the function requires one", async () => {
  const r = await readJson(post(null)); assert(r.ok); assertEquals(r.value, {});
  const r2 = await readJson(post("  ")); assert(r2.ok); assertEquals(r2.value, {});
  const r3 = await readJson(post(null), { requireBody: true }); assert(!r3.ok); assertEquals(r3.status, 400);
});

Deno.test("readJson: bad JSON, a list, a string and null are 400, never a throw", async () => {
  for (const b of ["{nope", "[1,2]", '"text"', "null", "123", "{\"a\":"]) {
    const r = await readJson(post(b)); assert(!r.ok, b); assertEquals(r.status, 400, b);
    assertEquals(await r.response.json(), { error: r.message });
  }
  const list = await readJson(post("[1,2]"), { allowArray: true }); assert(list.ok);
});

Deno.test("readJson: over the byte cap is 413 - by Content-Length without reading, and by counting when the header lies or is missing", async () => {
  const big = JSON.stringify({ a: "x".repeat(DEFAULT_MAX_BYTES + 10) });
  const r = await readJson(post(big)); assert(!r.ok); assertEquals(r.status, 413);
  const lying = await readJson(post(big, { "content-length": "10" })); assert(!lying.ok); assertEquals(lying.status, 413);
  const declared = await readJson(post("{}", { "content-length": String(DEFAULT_MAX_BYTES * 4) })); assert(!declared.ok); assertEquals(declared.status, 413);
  const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(64 * 1024)); } });
  const endless = await readJson(new Request("https://x.test/f", { method: "POST", body: stream, duplex: "half" } as RequestInit)); assert(!endless.ok); assertEquals(endless.status, 413);
  const files = await readJson(post(big), { maxBytes: 5 * 1024 * 1024 }); assert(files.ok, "a function that takes files may raise the cap");
});

Deno.test("readJson: deep nesting is 400 before the parser sees it", async () => {
  const deep = "[".repeat(5000) + "]".repeat(5000);
  const r = await readJson(post(`{"a":${deep}}`)); assert(!r.ok); assertEquals(r.code, "too_deep");
  assertEquals(jsonDepth('{"a":"[[[[[[[[[[[[[[[[[[[["}', 12), 1, "brackets inside strings do not count");
  assertEquals(jsonDepth('{"a":"\\"[[[[[[[[[[[[[["}', 12), 1, "escaped quotes do not end a string");
  const fine = await readJson(post(JSON.stringify({ a: { b: { c: { d: [1] } } } }))); assert(fine.ok);
});

Deno.test("readJson: a 10,000-item list, a 5,000-key object and a huge value count are 400", async () => {
  const list = await readJson(post(JSON.stringify({ items: new Array(10000).fill(1) }))); assert(!list.ok); assertEquals(list.code, "too_many_items");
  const keys = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, 1]));
  const obj = await readJson(post(JSON.stringify(keys))); assert(!obj.ok); assertEquals(obj.code, "too_many_items");
  const many = await readJson(post(JSON.stringify({ a: Array.from({ length: 15 }, () => new Array(1900).fill(0)) }))); assert(!many.ok, "15 x 1900 values is over 20,000");
  const raised = await readJson(post(JSON.stringify({ items: new Array(10000).fill(1) })), { maxArray: 20000, maxValues: 50000 }); assert(raised.ok);
});

Deno.test("readJson: NUL bytes, control characters and lone surrogates are taken out of every string; __proto__ is dropped", async () => {
  const r = await readJson(post('{"a":"x\\u0000y","b":{"c":["p\\u0007q","\\ud800z"]},"__proto__":{"admin":true},"k\\u0000":1}'));
  assert(r.ok);
  assertEquals(r.value, { a: "xy", b: { c: ["pq", "z"] }, k: 1 });
  assertEquals(({} as Record<string, unknown>).admin, undefined);
  assertEquals(Object.getPrototypeOf(r.value), Object.prototype);
  const keep = await readJson(post('{"t":"line1\\nline2\\ttab"}')); assert(keep.ok); assertEquals(keep.value, { t: "line1\nline2\ttab" });
});

Deno.test("readJson: the refusal carries the function's headers and can use its own error shape", async () => {
  const r = await readJson(post("{nope"), { headers: { "Access-Control-Allow-Origin": "*" }, errorBody: ({ code, message }) => ({ error: code, message }) });
  assert(!r.ok);
  assertEquals(r.response.headers.get("access-control-allow-origin"), "*");
  assertEquals(r.response.headers.get("content-type"), "application/json");
  assertEquals(await r.response.json(), { error: "invalid_json", message: "The request body is not valid JSON." });
});

Deno.test("readJson: a hostile corpus never throws and is always 400/413", async () => {
  const corpus: BodyInit[] = ["\u0000", "\uFEFF{}x", "{" + '"a":'.repeat(100000), "{\"a\":1e999999}x", "[".repeat(100000), "\ud800", new Uint8Array([0xff, 0xfe, 0x00, 0x7b])];
  for (const b of corpus) { const r = await readJson(post(b)); if (!r.ok) assert(r.status === 400 || r.status === 413); }
});

Deno.test("parseBody: a schema fails with the field named; unknown fields are dropped; values are cleaned", async () => {
  const check = object({ prompt: text({ min: 1, max: 20 }), mode: optional(oneOf(["build", "chat"] as const)), id: optional(uuid) });
  const good = await parseBody(post(JSON.stringify({ prompt: "  hello\u202E  ", mode: "chat", extra: 1 })), check); assert(good.ok);
  assertEquals<unknown>(good.value, { prompt: "hello", mode: "chat" });
  const long = await parseBody(post(JSON.stringify({ prompt: "x".repeat(21) })), check); assert(!long.ok); assertEquals(await long.response.json(), { error: "prompt: must be at most 20 characters" });
  const wrong = await parseBody(post(JSON.stringify({ prompt: 5 })), check); assert(!wrong.ok); assertEquals(wrong.message, "prompt: must be text");
  const badId = await parseBody(post(JSON.stringify({ prompt: "a", id: "nope" })), check); assert(!badId.ok); assertEquals(badId.message, "id: must be an id");
});

Deno.test("readQuery: parameters go through their checks", () => {
  const shape = { limit: optional(int({ min: 1, max: 100 })), id: uuid };
  const id = "00000000-0000-0000-0000-0000000000a1";
  const ok = readQuery(new Request(`https://x.test/f?id=${id}&limit=5&junk=1`), shape); assert(ok.ok); assertEquals(ok.value.id, id); assertEquals(ok.value.limit, 5); assertEquals(Object.keys(ok.value).sort(), ["id", "limit"]);
  const bad = readQuery(new Request(`https://x.test/f?id=${id}&limit=999`), shape); assert(!bad.ok); assertEquals(bad.status, 400);
  const missing = readQuery(new Request("https://x.test/f"), shape); assert(!missing.ok);
});

Deno.test("cleanText: removes what hides or breaks text, keeps paragraphs, normalizes, caps without splitting a pair", () => {
  assertEquals(cleanText("a\u0000b\u0007c"), "abc");
  assertEquals(cleanText("invoice_\u202Efdp.exe"), "invoice_fdp.exe");
  assertEquals(cleanText("x\u2066y\u2069"), "xy");
  assertEquals(cleanText("a\r\nb\rc"), "a\nb\nc");
  assertEquals(cleanText("line1\nline2\tx"), "line1\nline2\tx");
  assertEquals(cleanText("a\nb", { multiline: false }), "a b");
  assertEquals(cleanText("e\u0301"), "\u00e9");
  assertEquals(cleanText("\ud83d"), "");
  assertEquals(cleanText("  hi  "), "hi");
  assertEquals(cleanText("😀😀😀", { max: 2 }), "😀😀");
  assertEquals(clip("😀😀", 1), "😀");
  assertEquals(cleanText("a\u{E0041}b"), "ab", "tag characters are invisible");
  assertEquals(cleanText(null), ""); assertEquals(cleanText(12), "12");
  assertEquals(scrubString("a\u0000\u0008b\ud800 c"), "ab c");
  assertEquals(cleanText("👨‍👩‍👧 family"), "👨‍👩‍👧 family", "joiners in emoji stay");
});

Deno.test("safeFileName: letters, digits . _ - only, at most 80, no path, never empty", () => {
  assertEquals(safeFileName("../../etc/passwd"), "passwd");
  assertEquals(safeFileName("C:\\Users\\me\\my photo (1).PNG"), "my_photo_1_.PNG");
  assertEquals(safeFileName("..."), "file");
  assertEquals(safeFileName(""), "file");
  assertEquals(safeFileName(".htaccess"), "htaccess");
  assertEquals(safeFileName("a".repeat(200) + ".png").length, 80);
  assert(safeFileName("a".repeat(200) + ".png").endsWith(".png"));
  assertEquals(safeFileName("na\u0000me\u202E.txt"), "name.txt");
  assert(/^[A-Za-z0-9._-]+$/.test(safeFileName("ünï cödé 名前.txt")));
});

Deno.test("schema: clip mode cuts and drops instead of refusing (for model output); strict mode refuses", () => {
  const strict = array(text({ max: 3 }), { max: 2 });
  assert(!strict(["a", "b", "c"]).ok); assert(!strict(["abcd"]).ok);
  const clipped = array(text({ max: 3, clip: true }), { max: 2, clip: true, dropInvalid: true });
  assertEquals(clipped(["abcdef", 5, "x", "y"]), { ok: true, value: ["abc", "x"] });
  assertEquals(object({ a: withDefault(int(), 7) })({ a: "nope", z: 1 }), { ok: true, value: { a: 7 } });
  assert(!object({ a: int() }, { unknown: "reject" })({ a: 1, b: 2 }).ok);
  assertEquals<unknown>(object({ a: int() }, { unknown: "keep" })({ a: 1, b: 2 }), { ok: true, value: { a: 1, b: 2 } });
  assertEquals(record(int(), { maxKeys: 2, clip: true })({ a: 1, b: 2, c: 3, __proto__: 4 }), { ok: true, value: { a: 1, b: 2 } });
  assertEquals(int({ min: 1, max: 5, clamp: true })(99), { ok: true, value: 5 });
  assert(!int()(1.5).ok); assert(!int()("12abc").ok);
});

Deno.test("schema url: https only, no credentials, optional relative path, optional host rule", () => {
  const u = url({ relative: true });
  assert(u("https://example.com/a").ok); assert(u("/img/a.png").ok);
  for (const bad of ["http://example.com", "javascript:alert(1)", "data:text/html,x", "//evil.com/x", "https://user:pw@example.com", "/\\evil.com", "ftp://x", ""]) assert(!u(bad).ok, bad);
  assert(!url({ hosts: (h) => h.endsWith(".youtube.com") })("https://evil.com/x").ok);
  assert(url({ hosts: (h) => h.endsWith(".youtube.com") })("https://www.youtube.com/embed/x").ok);
});
