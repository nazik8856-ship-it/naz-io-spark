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

  it("masks Anthropic, OpenAI project, Stripe live, GitHub fine-grained and AWS keys too, and not ordinary hyphenated words", () => {
    const keys = [
      "sk-ant-api03-" + "Ab1_".repeat(8), "sk-proj-" + "Xy9-".repeat(8), "sk_live_" + "a1".repeat(10), "rk_live_" + "b2".repeat(10),
      "github_pat_" + "11AB_cd".repeat(4), "AKIA" + "ABCD1234EFGH5678",
    ];
    for (const k of keys) expect(maskSensitive(`key: ${k} end`)).toBe("key: [REDACTED:secrets] end");
    expect(maskSensitive("We need a risk-assessment-framework and a task-management-platform.")).toBe("We need a risk-assessment-framework and a task-management-platform.");
  });
});
