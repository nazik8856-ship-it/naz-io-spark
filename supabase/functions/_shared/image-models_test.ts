// Run with: deno test supabase/functions/_shared/image-models_test.ts
import { DEFAULT_OPENAI_IMAGE_MODELS, openaiImageModels } from "./image-models.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

Deno.test("no setting: gpt-image-2 first, never the retired gpt-image-1", () => {
  assertEquals(openaiImageModels(undefined), ["gpt-image-2", "gpt-image-1.5"]);
  assertEquals(openaiImageModels(""), ["gpt-image-2", "gpt-image-1.5"]);
  assertEquals(openaiImageModels("   "), ["gpt-image-2", "gpt-image-1.5"]);
  assert(!DEFAULT_OPENAI_IMAGE_MODELS.includes("gpt-image-1" as never), "the retired model is not a default");
});

Deno.test("a configured model goes first and is not repeated", () => {
  assertEquals(openaiImageModels("gpt-image-3"), ["gpt-image-3", "gpt-image-2", "gpt-image-1.5"]);
  assertEquals(openaiImageModels(" gpt-image-2 "), ["gpt-image-2", "gpt-image-1.5"]);
});

Deno.test("a value that is not a model name is dropped, the defaults stay", () => {
  assertEquals(openaiImageModels("gpt image; drop"), ["gpt-image-2", "gpt-image-1.5"]);
  assertEquals(openaiImageModels("x".repeat(80)), ["gpt-image-2", "gpt-image-1.5"]);
});
