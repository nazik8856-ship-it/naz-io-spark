// AUDIT 5 (Trust Score + Provenance + Control Report, 2026-10-07): real
// test for the misclassification bug this audit found -- a redaction note
// written by the FINAL-ASSEMBLY check ("...was redacted across this site
// at final-assembly check...") used to be miscounted as "flagged" instead
// of "redacted" in this widget's badge, purely because its wording didn't
// match the exact generation-time phrase the classifier hard-coded. The
// generation-time path and the final-assembly path both call this the
// same thing to a human reading the badge -- a count that silently
// undercounts "redacted" and overcounts "flagged" misreports what this
// Control Report is specifically built to report accurately.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import WebsiteControlReport from "@/components/websites/WebsiteControlReport";

function renderBadge(notes: string[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WebsiteControlReport notes={notes} />);
  });
  return container;
}

describe("WebsiteControlReport", () => {
  it("counts a generation-time redaction note as redacted", () => {
    const container = renderBadge([
      `Content matching your safety rule(s) (Leaked API key) was redacted at generation time.`,
    ]);
    expect(container.textContent).toContain("1 redacted");
    expect(container.textContent).not.toContain("flagged");
  });

  it("counts a final-assembly-check redaction note as redacted too, not flagged", () => {
    const container = renderBadge([
      `Content matching your safety rule(s) (Leaked API key) was redacted across this site at final-assembly check -- it may have been added or edited after this site was first generated.`,
    ]);
    expect(container.textContent).toContain("1 redacted");
    expect(container.textContent).not.toContain("flagged");
  });

  it("still counts a non-redaction finding as flagged", () => {
    const container = renderBadge([
      `This site's assembled content touches your safety rule(s) (Destructive wording) -- not blocked (descriptive content, not an action), but worth reviewing.`,
    ]);
    expect(container.textContent).toContain("1 flagged");
    expect(container.textContent).not.toContain("redacted");
  });

  it("a mix of both final-assembly notes counts correctly as 1 redacted and 1 flagged, not 2 flagged", () => {
    const container = renderBadge([
      `Content matching your safety rule(s) (Leaked API key) was redacted across this site at final-assembly check -- it may have been added or edited after this site was first generated.`,
      `This site's assembled content touches your safety rule(s) (Destructive wording) -- not blocked (descriptive content, not an action), but worth reviewing.`,
    ]);
    expect(container.textContent).toContain("1 redacted");
    expect(container.textContent).toContain("1 flagged");
  });

  it("no notes renders the clean state", () => {
    const container = renderBadge([]);
    expect(container.textContent).toContain("clean");
  });
});
