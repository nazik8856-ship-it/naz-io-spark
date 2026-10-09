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

function renderBadge(notes: string[], trustScore?: number | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WebsiteControlReport notes={notes} trustScore={trustScore} />);
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

  // GAP 3 (Trust Score + Provenance + Control Report, 2026-10-09): renders
  // the numeric score compile-website-manifest/final-assembly-check.ts now
  // persist on the website row, not just the clean/flagged note badge.
  it("renders a passed-in trust score", () => {
    const container = renderBadge(
      [`This site's assembled content touches your safety rule(s) (Destructive wording) -- not blocked.`],
      60,
    );
    expect(container.textContent).toContain("60");
  });

  it("falls back to 100 when clean and no trust score was passed", () => {
    const container = renderBadge([]);
    expect(container.textContent).toContain("100");
  });

  // Correctness verification follow-up (2026-10-09): the score badge's
  // "ml-auto" is what pushes the whole right-hand group to the header's
  // far edge. When there's no numeric trust score to show (an older
  // website with flagged notes but trust_score still null -- the state
  // any website generated before this GAP shipped is in until its next
  // publish or sweep run), the score badge doesn't render at all, so
  // something else in the row must carry that "ml-auto" or the flagged/
  // redacted count badge collapses left instead of staying right-aligned.
  it("the flagged/redacted badge keeps its right-alignment margin when no numeric trust score is available", () => {
    const container = renderBadge([
      `This site's assembled content touches your safety rule(s) (Destructive wording) -- not blocked.`,
    ]);
    const spans = Array.from(container.querySelectorAll("span"));
    const countBadge = spans.find((s) => s.textContent?.includes("flagged"));
    expect(countBadge, "expected to find the flagged-count badge").toBeTruthy();
    expect(countBadge!.className).toContain("ml-auto");
  });
});
