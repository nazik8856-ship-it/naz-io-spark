import { describe, it, expect } from "vitest";
import { maskSensitive } from "@/lib/mask-sensitive";

describe("maskSensitive", () => {
  it("masks keys, card numbers and national ids and leaves other text alone", () => {
    const key = "sk-" + "a".repeat(24);
    const out = maskSensitive(`Use ${key}, card 4111111111111111 and id 123-45-6789 please.`);
    expect(out).toBe("Use [REDACTED:secrets], card [REDACTED:pii] and id [REDACTED:pii] please.");
    expect(maskSensitive("Nothing sensitive here.")).toBe("Nothing sensitive here.");
    expect(maskSensitive(null)).toBe("");
  });

  it("masks text a custom cut-out rule matched, and ignores a broken stored pattern", () => {
    const matches = [{ pattern: "zzplanzz", category: "custom", redact: true }, { pattern: "([", category: "custom", redact: true }, { pattern: "falcon", category: "custom" }];
    expect(maskSensitive("The zzplanzz and the falcon.", matches)).toBe("The [REDACTED:custom] and the falcon.");
  });
});
