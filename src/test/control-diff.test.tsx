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
