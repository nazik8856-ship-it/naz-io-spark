import { describe, it, expect } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { extractFunctionErrorMessage } from "@/lib/supabase-function-error";

const err = (body: unknown) => new FunctionsHttpError(new Response(JSON.stringify(body), { status: 502 }));

describe("extractFunctionErrorMessage", () => {
  it("prefers the plain-words reason, then summary, then the error code", async () => {
    expect(await extractFunctionErrorMessage(err({ error: "rate_limited", message: "Too many requests. Try again shortly." }))).toBe("Too many requests. Try again shortly.");
    expect(await extractFunctionErrorMessage(err({ ok: false, summary: "send_email needs to, subject and body — nothing was sent." }))).toBe("send_email needs to, subject and body — nothing was sent.");
    expect(await extractFunctionErrorMessage(err({ error: "rate_limited" }))).toBe("rate_limited");
  });
  it("gives null when there is nothing readable", async () => {
    expect(await extractFunctionErrorMessage(err({}))).toBeNull();
    expect(await extractFunctionErrorMessage(new Error("x"))).toBeNull();
  });
});
