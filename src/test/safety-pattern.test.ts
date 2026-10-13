import { describe, expect, it } from "vitest";
import { findPatternProblem } from "@/lib/safety-pattern";

describe("findPatternProblem", () => {
  it("accepts ordinary patterns", () => {
    for (const p of ["project\\s+falcon", "(acme|globex)", "\\b\\d{3}-\\d{2}-\\d{4}\\b", "sk-[A-Za-z0-9]{16,}"]) expect(findPatternProblem(p)).toBeNull();
  });
  it("rejects a pattern that does not parse", () => {
    expect(findPatternProblem("(unclosed")).toMatch(/valid expression/);
  });
  it("rejects patterns that match empty text", () => {
    for (const p of [".*", "\\d*", "a?", ""]) expect(findPatternProblem(p)).toMatch(/empty text/);
  });
  it("rejects nested quantifiers that can hang a scan", () => {
    for (const p of ["(a+)+$", "(\\d+)*x", "(.*a)+"]) expect(findPatternProblem(p)).toMatch(/repeats a repeated group/);
  });
});
