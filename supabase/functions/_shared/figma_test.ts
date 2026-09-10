// Real tests for figma.ts's pure token-error-message builder.
//
// Run with: deno test --allow-none supabase/functions/_shared/figma_test.ts
import { summarizeFigmaTokenError } from "./figma.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("summarizeFigmaTokenError: leads with the error code, not the generic boilerplate description", () => {
  const msg = summarizeFigmaTokenError({ error: "invalid_grant", error_description: "An error occurred processing your request" }, 400);
  assert(msg.startsWith("invalid_grant"), msg);
  assert(msg.includes("An error occurred processing your request"), msg);
});

Deno.test("summarizeFigmaTokenError: a longer, distinct error string is still included alongside the description", () => {
  const msg = summarizeFigmaTokenError({ error: "Client ID is required", error_description: "An error occurred processing your request" }, 400);
  assert(msg.startsWith("Client ID is required"), msg);
});

Deno.test("summarizeFigmaTokenError: skips the redundant suffix when description equals the code", () => {
  const msg = summarizeFigmaTokenError({ error: "invalid_grant", error_description: "invalid_grant" }, 400);
  assert(msg === "invalid_grant", msg);
});

Deno.test("summarizeFigmaTokenError: no error code at all falls back to message/description alone", () => {
  const msg = summarizeFigmaTokenError({ message: "Something specific went wrong" }, 400);
  assert(msg === "Something specific went wrong", msg);
});

Deno.test("summarizeFigmaTokenError: completely empty body falls back to the status-coded default", () => {
  const msg = summarizeFigmaTokenError({}, 500);
  assert(msg === "Figma token exchange failed (500)", msg);
});

Deno.test("summarizeFigmaTokenError: null/undefined body doesn't throw", () => {
  assert(summarizeFigmaTokenError(null, 502) === "Figma token exchange failed (502)");
  assert(summarizeFigmaTokenError(undefined, 502) === "Figma token exchange failed (502)");
});
