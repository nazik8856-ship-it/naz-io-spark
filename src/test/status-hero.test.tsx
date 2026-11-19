import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StatusHero, { CoverageRing } from "@/components/control/dashboard/StatusHero";
import type { StatusSummary } from "@/lib/inner-control-ui";

const ACTIVE: StatusSummary = { state: "active", headline: "3 rules active", detail: "Last checked 5 min ago · today 2 of 14 checks changed, held or blocked something" };

const checks = (over: Partial<Record<string, boolean>> = {}) => [
  { label: "Hard rules", done: over.hard ?? true, onClick: vi.fn() },
  { label: "Safety rules", done: over.safety ?? true, onClick: vi.fn() },
  { label: "Daily spend limit", done: over.spend ?? false, onClick: vi.fn() },
  { label: "Agent deployed", done: over.agent ?? false, onClick: vi.fn() },
];

describe("CoverageRing", () => {
  it("lights the covered share of its 60 ticks and says it in words", () => {
    const { rerender } = render(<CoverageRing pct={45} />);
    const ring = screen.getByTestId("coverage-ring");
    expect(ring.getAttribute("aria-label")).toBe("Coverage 45%");
    expect(ring.getAttribute("data-lit")).toBe("27");
    rerender(<CoverageRing pct={100} />);
    expect(screen.getByTestId("coverage-ring").getAttribute("data-lit")).toBe("60");
    rerender(<CoverageRing pct={null} />);
    expect(screen.getByTestId("coverage-ring").getAttribute("aria-label")).toBe("Coverage not measured yet");
    expect(screen.getByTestId("coverage-ring").getAttribute("data-lit")).toBe("0");
    rerender(<CoverageRing pct={250} />);
    expect(screen.getByTestId("coverage-ring").getAttribute("data-lit")).toBe("60");
  });
});

describe("StatusHero", () => {
  it("shows the status line, and the next unfinished step as one button", () => {
    const c = checks();
    render(<StatusHero coveragePct={45} status={ACTIVE} checks={c} />);
    expect(screen.getByTestId("status-line").textContent).toBe("3 rules active");
    expect(screen.getByTestId("status-detail").textContent).toBe(ACTIVE.detail);
    expect(screen.getByTestId("setup-next").textContent).toBe("2 of 4 steps done · next: Daily spend limit");
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));
    expect(c[2].onClick).toHaveBeenCalledTimes(1);
    expect(c[3].onClick).not.toHaveBeenCalled();
  });
  it("has no button when every step is done, and stays visible", () => {
    render(<StatusHero coveragePct={100} status={{ state: "idle", headline: "1 rule active", detail: "Rules are set but nothing has run under them yet." }} checks={checks({ spend: true, agent: true })} />);
    expect(screen.getByTestId("setup-status")).toBeTruthy();
    expect(screen.queryByTestId("hero-action")).toBeNull();
    expect(screen.queryByTestId("setup-next")).toBeNull();
  });
  it("with no rules, the one button is the policy template and the line says nothing limits the AI", () => {
    const onClick = vi.fn();
    render(<StatusHero coveragePct={null} status={{ state: "no_rules", headline: "No rules yet, so nothing limits what your AI may do.", detail: null }} checks={checks({ hard: false, safety: false })} cta={{ label: "Start from a Policy Template", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: /Start from a Policy Template/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status-line").dataset.state).toBe("no_rules");
    expect(screen.queryByRole("button", { name: "Complete setup" })).toBeNull();
  });
  it("names approvals and incidents only when something is waiting", () => {
    const onApprovals = vi.fn();
    const { rerender } = render(<StatusHero coveragePct={50} status={ACTIVE} checks={checks()} />);
    expect(screen.queryByTestId("attention")).toBeNull();
    rerender(<StatusHero coveragePct={50} status={ACTIVE} checks={checks()} approvals={2} incidents={0} onApprovals={onApprovals} />);
    expect(screen.getByTestId("approvals-count").textContent).toBe("2");
    expect(screen.queryByTestId("incidents-count")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Approvals waiting/ }));
    expect(onApprovals).toHaveBeenCalled();
    rerender(<StatusHero coveragePct={50} status={ACTIVE} checks={checks()} approvals={0} incidents={3} />);
    expect(screen.getByTestId("incidents-count").textContent).toBe("3");
  });

  it("while the steps are not known, no step is shown as not done; rules but none enforcing: Review your rules", () => {
    const onReview = vi.fn();
    const { rerender } = render(<StatusHero coveragePct={null} status={{ state: "loading", headline: "Checking your rules…", detail: null }} checks={null} />);
    expect(screen.getByTestId("status-loading").textContent).toBe("Checking your rules…");
    expect(screen.queryByTestId("setup-next")).toBeNull();
    expect(screen.queryByTestId("hero-action")).toBeNull();
    rerender(<StatusHero coveragePct={null} checks={checks({ hard: false, safety: false })} onReviewRules={onReview}
      status={{ state: "none_enforcing", headline: "None of your 7 rules is enforcing yet", detail: "4 are in shadow mode (watched only) and 3 are switched off. Switch one on to make it apply." }} />);
    fireEvent.click(screen.getByRole("button", { name: "Review your rules" }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
