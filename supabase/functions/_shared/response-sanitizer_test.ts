// Real tests for the white-labeled "brain" endpoint's brand-leakage scrub
// and Markdown repair.
//
// Run with: deno test --allow-none supabase/functions/_shared/response-sanitizer_test.ts
import { scrubSelfDisclosure, repairMarkdown, sanitizeResponse, containsSelfDisclosure } from "./response-sanitizer.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

// ---- scrubSelfDisclosure ----

Deno.test("scrubSelfDisclosure: leaves a clean answer with no self-disclosure untouched", () => {
  const r = scrubSelfDisclosure("Our support hours are 9-5 ET on weekdays.");
  assertFalse(r.intervened);
  assert(r.text === "Our support hours are 9-5 ET on weekdays.");
});

Deno.test("scrubSelfDisclosure: drops a sentence that names NazAI", () => {
  const r = scrubSelfDisclosure("I'm NazAI, here to help. Our support hours are 9-5 ET.");
  assert(r.intervened);
  assertFalse(r.text.toLowerCase().includes("nazai"));
  assert(r.text.includes("Our support hours are 9-5 ET."));
});

Deno.test("scrubSelfDisclosure: drops an 'as an AI' self-disclosure sentence", () => {
  const r = scrubSelfDisclosure("As an AI, I can't make guarantees. Refunds take 5-7 days.");
  assert(r.intervened);
  assertFalse(r.text.toLowerCase().includes("as an ai"));
  assert(r.text.includes("Refunds take 5-7 days."));
});

Deno.test("scrubSelfDisclosure: drops a 'built by' disclosure and a named underlying model/vendor", () => {
  const r1 = scrubSelfDisclosure("I was built by a great engineering team. Here is your answer.");
  assert(r1.intervened);
  const r2 = scrubSelfDisclosure("I'm powered by Google Gemini under the hood. Here is your answer.");
  assert(r2.intervened);
});

Deno.test("scrubSelfDisclosure: falls back to an honest message when every sentence is self-disclosure", () => {
  const r = scrubSelfDisclosure("As an AI language model, I am NazAI.");
  assert(r.intervened);
  assert(r.text === "I don't have enough information to answer that.");
});

Deno.test("scrubSelfDisclosure: never false-positives on an unrelated word containing the pattern as a substring", () => {
  const r = scrubSelfDisclosure("Please contact us via chat if you need help.");
  assertFalse(r.intervened);
});

// ---- containsSelfDisclosure ----
// "/respond" MVP backlog, item 175: structured JSON mode's JSON-safe
// alternative to scrubSelfDisclosure (which would corrupt JSON syntax).

Deno.test("containsSelfDisclosure: false for a clean answer, even inside JSON", () => {
  assertFalse(containsSelfDisclosure('{"answer":"Our support hours are 9-5 ET."}'));
});

Deno.test("containsSelfDisclosure: true when a self-disclosure phrase appears anywhere in the text, including inside a JSON string value", () => {
  assert(containsSelfDisclosure('{"answer":"As an AI, I can help with that."}'));
  assert(containsSelfDisclosure("I'm NazAI, here to help."));
});

Deno.test("containsSelfDisclosure: never mutates or truncates -- it only ever reports true/false", () => {
  const text = '{"answer":"As an AI, I can help.","other":"field"}';
  containsSelfDisclosure(text);
  assert(text === '{"answer":"As an AI, I can help.","other":"field"}');
});

// ---- repairMarkdown ----

Deno.test("repairMarkdown: leaves well-formed Markdown untouched", () => {
  const text = "Here is code:\n```js\nconsole.log(1);\n```\nDone.";
  assert(repairMarkdown(text) === text);
});

Deno.test("repairMarkdown: closes an unbalanced code fence", () => {
  const text = "Here is code:\n```js\nconsole.log(1);";
  const repaired = repairMarkdown(text);
  const fenceCount = (repaired.match(/```/g) ?? []).length;
  assert(fenceCount % 2 === 0);
});

Deno.test("repairMarkdown: closes an unbalanced parenthesis/bracket/brace", () => {
  const repaired = repairMarkdown("This is a note (see details");
  assert(repaired.endsWith(")"));
  const repaired2 = repairMarkdown("An array [1, 2, 3");
  assert(repaired2.endsWith("]"));
});

Deno.test("repairMarkdown: never removes anything from an already-valid answer", () => {
  const text = "A normal sentence (with a balanced aside) and [a link](url).";
  assert(repairMarkdown(text) === text);
});

// ---- sanitizeResponse ----

Deno.test("sanitizeResponse: combines both passes", () => {
  const result = sanitizeResponse("As an AI, I can help. Your order ships tomorrow (see tracking");
  assertFalse(result.text.toLowerCase().includes("as an ai"));
  assert(result.text.includes("Your order ships tomorrow"));
  assert(result.text.endsWith(")"));
  assert(result.intervened);
});
