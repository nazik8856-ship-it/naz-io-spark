// Real tests for item 1's embedding pipeline pure logic + guard behavior.
//
// Run with: deno test --allow-none supabase/functions/_shared/decision-embeddings_test.ts
import { buildEmbeddingInput, formatEmbeddingLiteral, generateEmbedding, embedDecisionIfExternal, EMBEDDING_DIMENSIONS } from "./decision-embeddings.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- buildEmbeddingInput ----

Deno.test("buildEmbeddingInput: combines action_type, provider, and description", () => {
  const text = buildEmbeddingInput({ actionType: "send_email", provider: "Gmail", description: "Reply to a customer.", params: {} });
  assert(text.includes("send_email"));
  assert(text.includes("Gmail"));
  assert(text.includes("Reply to a customer."));
});

Deno.test("buildEmbeddingInput: appends non-empty params as JSON", () => {
  const text = buildEmbeddingInput({ actionType: "send_email", provider: "Gmail", description: "x", params: { to: "a@b.com" } });
  assert(text.includes('"to":"a@b.com"'));
});

Deno.test("buildEmbeddingInput: an empty params object is never appended as literal '{}'", () => {
  const text = buildEmbeddingInput({ actionType: "x", provider: "y", description: "z", params: {} });
  assertEquals(text.includes("{}"), false);
});

Deno.test("buildEmbeddingInput: unstringifiable params (e.g. a circular object) never throws", () => {
  // deno-lint-ignore no-explicit-any
  const circular: any = {};
  circular.self = circular;
  const text = buildEmbeddingInput({ actionType: "x", provider: "y", description: "z", params: circular });
  assert(text.includes("x"));
});

Deno.test("buildEmbeddingInput: same action always produces the same text -- deterministic", () => {
  const action = { actionType: "a", provider: "b", description: "c", params: { d: 1 } };
  assertEquals(buildEmbeddingInput(action), buildEmbeddingInput({ ...action }));
});

Deno.test("buildEmbeddingInput: truncates to 4000 chars", () => {
  const text = buildEmbeddingInput({ actionType: "x", provider: "y", description: "z".repeat(5000), params: {} });
  assertEquals(text.length, 4000);
});

// ---- formatEmbeddingLiteral ----

Deno.test("formatEmbeddingLiteral: formats a vector as a pgvector literal string", () => {
  assertEquals(formatEmbeddingLiteral([0.1, 0.2, 0.3]), "[0.1,0.2,0.3]");
});

Deno.test("formatEmbeddingLiteral: an empty vector formats as an empty literal", () => {
  assertEquals(formatEmbeddingLiteral([]), "[]");
});

// ---- generateEmbedding ----

Deno.test("generateEmbedding: returns null when LOVABLE_API_KEY is missing, never throws", async () => {
  const original = Deno.env.get("LOVABLE_API_KEY");
  Deno.env.delete("LOVABLE_API_KEY");
  try {
    const result = await generateEmbedding("some text");
    assertEquals(result, null);
  } finally {
    if (original !== undefined) Deno.env.set("LOVABLE_API_KEY", original);
  }
});

Deno.test("generateEmbedding: returns null for empty text without ever calling fetch", async () => {
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => { called = true; return Promise.resolve(new Response("{}")); }) as typeof fetch;
  try {
    const result = await generateEmbedding("");
    assertEquals(result, null);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("generateEmbedding: a non-2xx response is treated as failure, not thrown", async () => {
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("error", { status: 500 }))) as typeof fetch;
  try {
    const result = await generateEmbedding("some text");
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("generateEmbedding: a wrong-dimension vector is rejected, never silently stored", async () => {
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }))) as typeof fetch;
  try {
    const result = await generateEmbedding("some text");
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("generateEmbedding: a correctly-shaped response returns the real vector", async () => {
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0.5);
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: vector }] }), { status: 200 }))) as typeof fetch;
  try {
    const result = await generateEmbedding("some text");
    assertEquals(result, vector);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("generateEmbedding: a network error never throws, resolves to null", async () => {
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    const result = await generateEmbedding("some text");
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---- embedDecisionIfExternal ----

type Row = { data?: unknown; error?: unknown };
class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  insert(_row?: unknown) { return this; }
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

Deno.test("embedDecisionIfExternal: does nothing (never even reaches the table) when apiKeyId is missing", async () => {
  const original = Deno.env.get("LOVABLE_API_KEY");
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  let calledFrom = false;
  const client = {
    from(_table: string) { calledFrom = true; return new FakeQuery(() => ({ data: null, error: null })); },
    // deno-lint-ignore no-explicit-any
  } as any;
  try {
    await embedDecisionIfExternal(client, { decisionId: "d1", apiKeyId: null, userId: "u1", actionType: "x", provider: "y", description: "z", params: {} });
    assertEquals(calledFrom, false, "must never touch the table when apiKeyId is null");
  } finally {
    if (original !== undefined) Deno.env.set("LOVABLE_API_KEY", original); else Deno.env.delete("LOVABLE_API_KEY");
  }
});

Deno.test("embedDecisionIfExternal: does nothing when decisionId is missing", async () => {
  let calledFrom = false;
  const client = {
    from(_table: string) { calledFrom = true; return new FakeQuery(() => ({ data: null, error: null })); },
    // deno-lint-ignore no-explicit-any
  } as any;
  await embedDecisionIfExternal(client, { decisionId: null, apiKeyId: "key-1", userId: "u1", actionType: "x", provider: "y", description: "z", params: {} });
  assertEquals(calledFrom, false);
});

Deno.test("embedDecisionIfExternal: a failed embedding generation never inserts a row", async () => {
  Deno.env.delete("LOVABLE_API_KEY"); // forces generateEmbedding to return null
  let calledFrom = false;
  const client = {
    from(_table: string) { calledFrom = true; return new FakeQuery(() => ({ data: null, error: null })); },
    // deno-lint-ignore no-explicit-any
  } as any;
  await embedDecisionIfExternal(client, { decisionId: "d1", apiKeyId: "key-1", userId: "u1", actionType: "x", provider: "y", description: "z", params: {} });
  assertEquals(calledFrom, false);
});

Deno.test("embedDecisionIfExternal: a successful embedding inserts a decision_embeddings row with the pgvector literal", async () => {
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0.25);
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: vector }] }), { status: 200 }))) as typeof fetch;
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      assertEquals(table, "decision_embeddings");
      return {
        insert(row: Record<string, unknown>) { inserts.push(row); return new FakeQuery(() => ({ data: null, error: null })); },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  try {
    await embedDecisionIfExternal(client, { decisionId: "d1", apiKeyId: "key-1", userId: "u1", actionType: "send_email", provider: "Gmail", description: "z", params: {} });
    assertEquals(inserts.length, 1);
    assertEquals(inserts[0].decision_id, "d1");
    assertEquals(inserts[0].api_key_id, "key-1");
    assertEquals(inserts[0].embedding, formatEmbeddingLiteral(vector));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("embedDecisionIfExternal: a throwing insert never propagates -- best effort only", async () => {
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0.1);
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: vector }] }), { status: 200 }))) as typeof fetch;
  const client = {
    from(_table: string) { throw new Error("db down"); },
    // deno-lint-ignore no-explicit-any
  } as any;
  try {
    await embedDecisionIfExternal(client, { decisionId: "d1", apiKeyId: "key-1", userId: "u1", actionType: "x", provider: "y", description: "z", params: {} });
    // no throw = pass
  } finally {
    globalThis.fetch = originalFetch;
  }
});
