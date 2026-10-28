// Run with: deno test --allow-env supabase/functions/_shared/field-crypto_test.ts
// Data encryption, front 2: the shared field encryption. Round trip, tampering, a value moved to another row or column, a wrong
// key, rotation with a previous key, keyed fingerprints, the row helpers, the sweep, and the speed budget.
import {
  currentKeyPrefix, dataKeysFromEnv, decryptField, encryptField, fingerprint, fingerprintMatches, importFieldKeys, needsReencrypt,
  fromB64, openFields, sealFields, sweepColumn, toB64, toB64Table,
} from "./field-crypto.ts";
import { createClient, reset, table } from "../../../tests/outer-control-engine/fake-supabase.ts";

function assert(ok: unknown, m: string) { if (!ok) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
async function rejects(p: Promise<unknown>, m: string) { try { await p; } catch { return; } throw new Error(m); }

const KEY_A = toB64(new Uint8Array(32).fill(7));
const KEY_B = toB64(new Uint8Array(32).fill(9));
const keys = async (cur: string, prev?: string) => (await importFieldKeys(cur, prev))!;
const ref = { table: "outer_control_sessions", column: "objective", id: "11111111-1111-1111-1111-111111111111" };

Deno.test("round trip: text comes back, ciphertext reveals nothing and differs every time", async () => {
  const k = await keys(KEY_A);
  const a = await encryptField(k, ref, "Quarterly plan for ACME — confidential");
  const b = await encryptField(k, ref, "Quarterly plan for ACME — confidential");
  assert(a.startsWith(currentKeyPrefix(k)) && a !== b, "fresh IV per write, current key id in front");
  assert(!a.includes("ACME"), "no plain text in the stored value");
  assertEquals(await decryptField(k, ref, a), "Quarterly plan for ACME — confidential");
  assertEquals(await decryptField(k, ref, await encryptField(k, ref, "")), "");
});

Deno.test("a changed value, or one moved to another row or column, does not decrypt", async () => {
  const k = await keys(KEY_A);
  const v = await encryptField(k, ref, "secret plan");
  const [p, id, iv, ct] = v.split(":");
  const flipped = `${p}:${id}:${iv}:${ct.slice(0, -4)}${ct.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
  await rejects(decryptField(k, ref, flipped), "tampered ciphertext must fail");
  await rejects(decryptField(k, { ...ref, id: "22222222-2222-2222-2222-222222222222" }, v), "another row must fail");
  await rejects(decryptField(k, { ...ref, column: "context" }, v), "another column must fail");
  await rejects(decryptField(k, { ...ref, table: "outer_control_workflows" }, v), "another table must fail");
  await rejects(decryptField(k, ref, "plain text"), "an unknown format must fail");
});

Deno.test("a wrong key fails; a short or missing key is refused", async () => {
  const v = await encryptField(await keys(KEY_A), ref, "x");
  await rejects(decryptField(await keys(KEY_B), ref, v), "another key must fail");
  assertEquals(await importFieldKeys(""), null);
  assertEquals(await importFieldKeys("too-short-password"), null);
  assert(await importFieldKeys("a".repeat(32)), "a 32+ character password is accepted");
  assertEquals(await dataKeysFromEnv(() => undefined), null);
});

Deno.test("rotation: values on the previous key still decrypt, are flagged, and re-encrypt onto the new key", async () => {
  const old = await keys(KEY_A);
  const v = await encryptField(old, ref, "kept through the rotation");
  const rotated = await keys(KEY_B, KEY_A);
  assert(needsReencrypt(rotated, v), "a value on the previous key needs re-encrypting");
  assertEquals(await decryptField(rotated, ref, v), "kept through the rotation");
  const moved = await encryptField(rotated, ref, await decryptField(rotated, ref, v));
  assert(!needsReencrypt(rotated, moved), "re-encrypted onto the current key");
  await rejects(decryptField(await keys(KEY_B), ref, v), "once the previous key is removed, an unmoved value fails (visible, never silent)");
  assertEquals((await keys(KEY_A, KEY_A)).previous, null, "a previous key equal to the current one is ignored");
});

Deno.test("fingerprints: keyed, stable, and plain SHA-256 values from before still match", async () => {
  const k = await keys(KEY_A);
  const f = await fingerprint(k, "hello");
  assertEquals(f.length, 64);
  assertEquals(f, await fingerprint(k, "hello"));
  assert(f !== await fingerprint(k, "hello!"), "different text, different fingerprint");
  assert(f !== "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", "not the plain SHA-256 anyone can compute");
  assert(f !== await fingerprint(await keys(KEY_B), "hello"), "depends on the key");
  assert(await fingerprintMatches(k, f, "hello"), "matches its text");
  assert(!await fingerprintMatches(k, f, "hullo"), "not another text");
  assert(await fingerprintMatches(k, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", "hello"), "a stored plain SHA-256 still matches");
  assert(await fingerprintMatches(await keys(KEY_B, KEY_A), f, "hello"), "a fingerprint under the previous key still matches");
  assert(!await fingerprintMatches(k, null, "hello") && !await fingerprintMatches(k, "", ""), "nothing stored never matches");
});

Deno.test("rows: sealFields encrypts into <col>_enc and empties the plain column; openFields reads either", async () => {
  const k = await keys(KEY_A);
  const id = ref.id;
  const patch = await sealFields(k, "outer_control_sessions", id, { objective: "Ship the plan", history: [{ step: 1, text: "hi" }], status: "running" }, ["objective", "history", "final_output"], { objective: "" });
  assertEquals(Object.keys(patch).sort(), ["history", "history_enc", "objective", "objective_enc"], "only listed columns that are present");
  assertEquals(patch.objective, "", "a NOT NULL column is emptied to its empty value");
  assertEquals(patch.history, null);
  const row = { id, status: "running", ...patch };
  const opened = await openFields(k, "outer_control_sessions", row, ["objective", "history"]);
  assertEquals(opened, { id, status: "running", objective: "Ship the plan", history: [{ step: 1, text: "hi" }] });
  assertEquals(await openFields(k, "outer_control_sessions", { id, objective: "old plain row", objective_enc: null }, ["objective"]), { id, objective: "old plain row" }, "an unconverted row reads its plain value");
  await rejects(openFields(k, "outer_control_sessions", { ...row, id: "33333333-3333-3333-3333-333333333333" }, ["objective"]), "a value copied to another row fails loudly");
  assertEquals((await sealFields(k, "t", id, { a: null }, ["a"])).a_enc, null, "null stays null");
});

Deno.test("sweep: converts plain rows a batch at a time, skips emptied rows, then moves values off the previous key", async () => {
  reset();
  const admin = createClient("", "");
  const t = table("notes");
  for (let i = 0; i < 5; i++) t.push({ id: `row-${i}`, body: `note ${i}`, body_enc: null });
  t.push({ id: "done", body: "", body_enc: null });
  const kA = await keys(KEY_A);
  const r1 = await sweepColumn(admin, kA, "notes", "body", { limit: 3, empty: "" });
  assertEquals([r1.encrypted, r1.failed], [3, 0]);
  const r2 = await sweepColumn(admin, kA, "notes", "body", { limit: 3, empty: "" });
  assertEquals(r2.encrypted, 2, "the next run reaches the rest, not the already-emptied rows");
  assert(t.every((r) => r.body === ""), "every plain value emptied");
  for (const r of t.filter((r) => r.body_enc)) assertEquals((await openFields(kA, "notes", r, ["body"])).body, `note ${r.id.slice(4)}`);

  const kB = await keys(KEY_B, KEY_A);
  const r3 = await sweepColumn(admin, kB, "notes", "body", { limit: 10, empty: "" });
  assertEquals([r3.encrypted, r3.reencrypted, r3.failed], [0, 5, 0]);
  assert(t.filter((r) => r.body_enc).every((r) => !needsReencrypt(kB, r.body_enc)), "all on the new key");
  assertEquals((await openFields(await keys(KEY_B), "notes", t[0], ["body"])).body, "note 0", "readable without the previous key");
});

Deno.test("base64: the fallback encoder matches btoa for every padding case, and decoding round-trips", () => {
  for (let n = 0; n < 70; n++) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    const ref = btoa(String.fromCharCode(...b));
    assertEquals(toB64Table(b), ref, `length ${n}`);
    assertEquals(toB64(b), ref);
    assertEquals([...fromB64(ref)], [...b]);
  }
});

Deno.test("speed: encrypting and decrypting 100 KB takes under 2 ms", async () => {
  const k = await keys(KEY_A);
  const text = "Lorem ipsum dolor sit amet, ünïcödé ✓ ".repeat(2700).slice(0, 100_000);
  for (let i = 0; i < 5; i++) await decryptField(k, ref, await encryptField(k, ref, text)); // warm up
  // The median of 41 runs, so one slow moment on a shared test machine does not decide it.
  const times: number[] = [];
  for (let i = 0; i < 41; i++) {
    const t0 = performance.now();
    await decryptField(k, ref, await encryptField(k, ref, text));
    times.push(performance.now() - t0);
  }
  const median = times.sort((a, b) => a - b)[20];
  console.log(`field-crypto: 100 KB encrypt + decrypt, median ${median.toFixed(3)} ms`);
  assert(median < 2, `took ${median.toFixed(3)} ms`);
});
