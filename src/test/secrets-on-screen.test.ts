// Secrets handling, front 2: a secret shown on screen (the one-time "copy it now" displays, the agent's trigger command) is never
// recorded by session replay. PostHog masks every input already; text on the page needs data-ph-mask on its element, and
// ph-no-capture keeps it out of click autocapture too.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHOWN: { file: string; expr: string }[] = [
  { file: "src/pages/ControlApiKeys.tsx", expr: "{justCreated.key}" },
  { file: "src/pages/ControlWebhooks.tsx", expr: "{justCreated.secret}" },
  { file: "src/components/agents/AgentEmployeePanel.tsx", expr: "{curlCommand}" },
];

describe("secrets shown on screen are masked in session replay", () => {
  it.each(SHOWN)("$file: the element showing $expr carries data-ph-mask and ph-no-capture", ({ file, expr }) => {
    const src = readFileSync(join(__dirname, "../..", file), "utf8");
    const at = src.indexOf(expr);
    expect(at, `${expr} not found in ${file}`).toBeGreaterThan(-1);
    const tag = src.slice(src.lastIndexOf("<", at), at);
    expect(tag).toContain("data-ph-mask");
    expect(tag).toContain("ph-no-capture");
  });

  it("replay masks inputs, and the masking selector is the one these elements use", () => {
    const ph = readFileSync(join(__dirname, "../lib/posthog.ts"), "utf8");
    expect(ph).toMatch(/maskAllInputs:\s*true/);
    expect(ph).toMatch(/maskTextSelector:\s*"\[data-ph-mask\]"/);
    expect(ph).toMatch(/before_send:\s*\(event\)\s*=>\s*scrubPostHogEvent\(event\)/);
  });
});
