import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ControlDiffView from "@/components/control/outer/ControlDiffView";
import { diffSummary } from "@/lib/outer-control-sessions";

const diff = {
  segments: [
    { t: "Falcon costs " }, { flagged: "$40", rule: "No prices", effect: "block" as const }, { t: ". Key " },
    { removed: "API key", rule: "API key or secret in payload" }, { t: "." },
  ],
  removed: 1, flagged: 1, truncated: false,
};

describe("Control Diff", () => {
  it("shows what the tool sent with the removed span as a label and its rule, then what NazAI passed on", () => {
    render(<ControlDiffView diff={diff} controlled="Falcon costs $40. Key [REDACTED:secrets]." toolName="ChatGPT" />);
    expect(screen.getByTestId("control-diff-summary").textContent).toBe("1 removed · 1 flagged");
    expect(screen.getByTestId("control-diff-tool").textContent).toBe("Falcon costs $40. Key [removed: API key · API key or secret in payload].");
    expect(screen.getByTestId("diff-flagged").getAttribute("title")).toBe('Blocked: "No prices"');
    fireEvent.click(screen.getByRole("tab", { name: /NazAI passed on/ }));
    expect(screen.getByTestId("control-diff-controlled").textContent).toBe("Falcon costs $40. Key [REDACTED:secrets].");
  });

  it("a blocked reply says nothing was passed on; a diff with no change has no summary", () => {
    render(<ControlDiffView diff={diff} controlled={null} toolName="Claude" />);
    fireEvent.click(screen.getByRole("tab", { name: /NazAI passed on/ }));
    expect(screen.getByTestId("control-diff-controlled").textContent).toMatch(/Nothing was passed on/);
    expect(diffSummary({ segments: [], removed: 0, flagged: 0, truncated: false })).toBeNull();
  });
});

import { meaningLines } from "@/lib/outer-control-sessions";
describe("meaning rule evidence on a step", () => {
  it("each finding with its quote and reason; a removed passage is not shown; an unavailable judge is said plainly", () => {
    expect(meaningLines({ checked: 2, unavailable: false, discarded: 1, findings: [
      { rule: "No delivery promises", action: "block", why: "It promises a time.", quote: "arrives Friday at noon" },
      { rule: "No medical advice", action: "remove", why: "Names a medicine.", quote: null },
    ] })).toEqual([
      "Meaning rule \"No delivery promises\" blocked it: “arrives Friday at noon” — It promises a time.",
      "Meaning rule \"No medical advice\" removed the passage: (the passage is not kept) — Names a medicine.",
    ]);
    expect(meaningLines({ checked: 1, unavailable: true, discarded: 0, findings: [] })[0]).toMatch(/not available, so a person decides/);
    expect(meaningLines({ checked: 3, unavailable: false, discarded: 0, findings: [] })).toEqual(["Meaning rules: 3 checked by the AI judge, none broken."]);
    expect(meaningLines(null)).toEqual([]);
  });
});
