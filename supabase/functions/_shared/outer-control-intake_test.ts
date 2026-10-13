// Run with: deno test --allow-env supabase/functions/_shared/outer-control-intake_test.ts
import { extractExternalText, MAX_CONTENT_CHARS, parseExternalId } from "./outer-control-intake.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("a plain string is accepted as-is", () => {
  assertEquals(extractExternalText("Hello there"), { ok: true, text: "Hello there", format: "text" });
});

Deno.test("OpenAI chat completion: message content is extracted, envelope ignored", () => {
  const r = extractExternalText({ id: "chatcmpl-1", choices: [{ index: 0, message: { role: "assistant", content: "Your order is on its way." }, finish_reason: "stop" }], usage: { total_tokens: 9 } });
  assertEquals(r, { ok: true, text: "Your order is on its way.", format: "openai_chat" });
});

Deno.test("OpenAI chat completion with several choices: all are judged", () => {
  const r = extractExternalText({ choices: [{ message: { content: "first" } }, { message: { content: "second" } }] });
  assertEquals(r.ok && r.text, "first\n\nsecond");
});

Deno.test("OpenAI chat completion with content blocks", () => {
  const r = extractExternalText({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "image_url", image_url: {} }, { type: "text", text: "b" }] } }] });
  assertEquals(r.ok && r.text, "a\n\nb");
});

Deno.test("OpenAI Responses API: output_text and output[] both work", () => {
  assertEquals(extractExternalText({ output_text: "hi" }), { ok: true, text: "hi", format: "openai_responses" });
  const r = extractExternalText({ output: [{ type: "message", content: [{ type: "output_text", text: "from output" }] }] });
  assertEquals(r, { ok: true, text: "from output", format: "openai_responses" });
});

Deno.test("Anthropic Messages: text blocks are joined", () => {
  const r = extractExternalText({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "Part one." }, { type: "text", text: "Part two." }] });
  assertEquals(r, { ok: true, text: "Part one.\n\nPart two.", format: "anthropic" });
});

Deno.test("Gemini: candidate parts are extracted", () => {
  const r = extractExternalText({ candidates: [{ content: { parts: [{ text: "gem" }, { text: "ini" }] } }] });
  assertEquals(r, { ok: true, text: "gem\n\nini", format: "gemini" });
});

Deno.test("a bare list of blocks is accepted", () => {
  assertEquals(extractExternalText([{ type: "text", text: "x" }]), { ok: true, text: "x", format: "blocks" });
});

Deno.test("an unknown object shape is refused, never judged as JSON text", () => {
  const r = extractExternalText({ foo: "bar" });
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.code, "unsupported_shape");
});

Deno.test("numbers, null and undefined are refused as unsupported", () => {
  for (const v of [42, null, undefined, true]) assertEquals(!extractExternalText(v).ok && (extractExternalText(v) as { code: string }).code, "unsupported_shape");
});

Deno.test("empty / whitespace-only / no-text responses -> content_required", () => {
  for (const v of ["", "   \n", { choices: [{ message: { content: "" } }] }, { content: [{ type: "image" }] }]) {
    const r = extractExternalText(v);
    assertEquals(!r.ok && r.code, "content_required");
  }
});

Deno.test("long answers up to the cap are accepted; over the cap is refused with the real length", () => {
  assertEquals(extractExternalText("a".repeat(MAX_CONTENT_CHARS)).ok, true);
  const r = extractExternalText("a".repeat(MAX_CONTENT_CHARS + 1));
  assertEquals(!r.ok && r.code, "content_too_long");
});

Deno.test("external_id: optional, trimmed, bounded", () => {
  assertEquals(parseExternalId(undefined), { ok: true, id: null });
  assertEquals(parseExternalId("  abc "), { ok: true, id: "abc" });
  assertEquals(parseExternalId("").ok, false);
  assertEquals(parseExternalId(5).ok, false);
  assertEquals(parseExternalId("x".repeat(201)).ok, false);
});

Deno.test("a response with tool/function calls is refused, never judged on its text alone", () => {
  const cases = [
    { choices: [{ message: { content: "Sure, deleting now", tool_calls: [{ function: { arguments: "{\"sql\":\"DROP TABLE users\"}" } }] } }] },
    { choices: [{ message: { content: "x", function_call: { name: "f", arguments: "{}" } } }] },
    { content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "t", name: "x", input: { k: "v" } }] },
    { output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }, { type: "function_call", name: "f", arguments: "{}" }] },
    { candidates: [{ content: { parts: [{ text: "ok" }, { functionCall: { name: "f", args: {} } }] } }] },
    [{ type: "text", text: "ok" }, { type: "tool_use" }],
  ];
  for (const c of cases) {
    const r = extractExternalText(c);
    assertEquals(!r.ok && r.code, "tool_calls_present");
  }
});

Deno.test("empty tool_calls arrays do not trigger the refusal", () => {
  const r = extractExternalText({ choices: [{ message: { content: "hello", tool_calls: [] } }] });
  assertEquals(r.ok && r.text, "hello");
});

Deno.test("an oversized raw object is refused before it is walked", () => {
  const big = { content: [{ type: "text", text: "a".repeat(MAX_CONTENT_CHARS * 4 + 10) }] };
  const r = extractExternalText(big);
  assertEquals(!r.ok && r.code, "content_too_long");
});
