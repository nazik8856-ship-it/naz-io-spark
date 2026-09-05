// Real tests for the white-labeled "brain" endpoint's grounding-context
// prompt builder and request parser.
//
// Run with: deno test --allow-none supabase/functions/_shared/response-context_test.ts
import {
  buildContextPromptBlock,
  parseRespondRequest,
  isValidPersona,
  findRelevantContext,
  MIN_CONTEXT_SIMILARITY,
  type ResponseContextEntry,
} from "./response-context.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- buildContextPromptBlock ----

Deno.test("buildContextPromptBlock: no entries produces an empty string, never an empty header", () => {
  assert(buildContextPromptBlock([]) === "");
});

Deno.test("buildContextPromptBlock: includes every entry's text and a grounding-framed header", () => {
  const entries: ResponseContextEntry[] = [
    { id: "1", entry_text: "Our support hours are 9-5 ET." },
    { id: "2", entry_text: "Refunds take 5-7 business days." },
  ];
  const block = buildContextPromptBlock(entries);
  assert(block.includes("Our support hours are 9-5 ET."));
  assert(block.includes("Refunds take 5-7 business days."));
  assert(block.includes("CONTEXT PROVIDED BY THIS INTEGRATION"));
  assert(block.includes("never invent facts beyond it"));
});

Deno.test("buildContextPromptBlock: truncates an overly long entry rather than blowing up the prompt", () => {
  const longText = "x".repeat(5000);
  const block = buildContextPromptBlock([{ id: "1", entry_text: longText }]);
  assert(block.length < longText.length + 200);
});

Deno.test("buildContextPromptBlock: caps the number of entries injected into the prompt", () => {
  const entries: ResponseContextEntry[] = Array.from({ length: 50 }, (_, i) => ({ id: String(i), entry_text: `fact ${i}` }));
  const block = buildContextPromptBlock(entries);
  assertFalse(block.includes("fact 49"));
  assert(block.includes("fact 0"));
});

// ---- parseRespondRequest ----

Deno.test("parseRespondRequest: rejects a missing or empty message", () => {
  const r1 = parseRespondRequest({});
  assert("error" in r1);
  const r2 = parseRespondRequest({ message: "   " });
  assert("error" in r2);
});

Deno.test("parseRespondRequest: rejects an oversized message", () => {
  const r = parseRespondRequest({ message: "x".repeat(5000) });
  assert("error" in r);
});

Deno.test("parseRespondRequest: accepts a plain message with no history", () => {
  const r = parseRespondRequest({ message: "What are your hours?" });
  if ("error" in r) throw new Error("expected success, got error: " + r.error);
  assert(r.message === "What are your hours?");
  assert(r.conversationHistory.length === 0);
});

Deno.test("parseRespondRequest: accepts valid conversation_history", () => {
  const r = parseRespondRequest({
    message: "And on weekends?",
    conversation_history: [
      { role: "user", content: "What are your hours?" },
      { role: "assistant", content: "9-5 ET on weekdays." },
    ],
  });
  if ("error" in r) throw new Error("expected success, got error: " + r.error);
  assert(r.conversationHistory.length === 2);
  assert(r.conversationHistory[0].role === "user");
  assert(r.conversationHistory[1].role === "assistant");
});

Deno.test("parseRespondRequest: rejects a history entry with an invalid role or empty content", () => {
  const r1 = parseRespondRequest({ message: "hi", conversation_history: [{ role: "system", content: "x" }] });
  assert("error" in r1);
  const r2 = parseRespondRequest({ message: "hi", conversation_history: [{ role: "user", content: "" }] });
  assert("error" in r2);
});

Deno.test("parseRespondRequest: rejects an oversized conversation_history", () => {
  const history = Array.from({ length: 25 }, () => ({ role: "user", content: "hi" }));
  const r = parseRespondRequest({ message: "hi", conversation_history: history });
  assert("error" in r);
});

// ---- isValidPersona ----

Deno.test("isValidPersona: null clears it, a reasonable string is valid", () => {
  assert(isValidPersona(null));
  assert(isValidPersona("Friendly and concise, uses first names."));
});

Deno.test("isValidPersona: rejects an empty string and an oversized one", () => {
  assertFalse(isValidPersona(""));
  assertFalse(isValidPersona("   "));
  assertFalse(isValidPersona("x".repeat(501)));
});

Deno.test("isValidPersona: rejects non-string, non-null values", () => {
  assertFalse(isValidPersona(42));
  assertFalse(isValidPersona(undefined));
});

// ---- findRelevantContext ----
// "/respond" MVP backlog, item 163: retrieval-based context.

// deno-lint-ignore no-explicit-any
type FakeAdmin = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> } & any;

Deno.test("findRelevantContext: maps RPC rows into ResponseContextEntry and applies the similarity floor", async () => {
  const client: FakeAdmin = {
    rpc(name: string, args: Record<string, unknown>) {
      assertEquals(name, "search_response_context");
      assertEquals(args._api_key_id, "key-1");
      return Promise.resolve({
        data: [
          { id: "e1", entry_text: "Relevant fact", similarity: 0.9 },
          { id: "e2", entry_text: "Unrelated fact", similarity: MIN_CONTEXT_SIMILARITY - 0.01 },
        ],
        error: null,
      });
    },
  };
  const entries = await findRelevantContext(client, "key-1", "[0.1,0.2]");
  assertEquals(entries.length, 1, "the below-floor row must be filtered out");
  assertEquals(entries[0].id, "e1");
  assertEquals(entries[0].entry_text, "Relevant fact");
});

Deno.test("findRelevantContext: an RPC error returns an empty array, never throws", async () => {
  const client: FakeAdmin = { rpc() { return Promise.resolve({ data: null, error: { message: "boom" } }); } };
  assertEquals(await findRelevantContext(client, "key-1", "[0.1]"), []);
});

Deno.test("findRelevantContext: a thrown exception returns an empty array, never propagates", async () => {
  const client: FakeAdmin = { rpc() { throw new Error("network down"); } };
  assertEquals(await findRelevantContext(client, "key-1", "[0.1]"), []);
});

Deno.test("findRelevantContext: a malformed (non-array) response returns an empty array", async () => {
  const client: FakeAdmin = { rpc() { return Promise.resolve({ data: "not an array", error: null }); } };
  assertEquals(await findRelevantContext(client, "key-1", "[0.1]"), []);
});

Deno.test("findRelevantContext: no matches at all returns an empty array, never throws", async () => {
  const client: FakeAdmin = { rpc() { return Promise.resolve({ data: [], error: null }); } };
  assertEquals(await findRelevantContext(client, "key-1", "[0.1]"), []);
});
