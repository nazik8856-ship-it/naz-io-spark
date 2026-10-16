import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SetupProgressBar from "@/components/control/dashboard/SetupProgressBar";
import RuleCoverageHealthCard from "@/components/control/dashboard/RuleCoverageHealthCard";

const checks = [
  { label: "Hard rules", done: false, onClick: () => {} },
  { label: "Safety rules", done: true, onClick: () => {} },
  { label: "Daily spend limit", done: false, onClick: () => {} },
  { label: "Agent deployed", done: true, onClick: () => {} },
];

describe("SetupProgressBar (Setup & status)", () => {
  it("shows the four indicators", () => {
    render(<SetupProgressBar pct={50} checks={checks} />);
    for (const l of ["Hard rules", "Safety rules", "Daily spend limit", "Agent deployed"]) {
      expect(screen.getByRole("button", { name: l })).toBeTruthy();
    }
  });
  it("with no rules shows a primary template button and calls it", () => {
    const onClick = vi.fn();
    render(<SetupProgressBar pct={25} checks={checks} cta={{ label: "Start from a Policy Template", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: /Start from a Policy Template/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("status-line")).toBeNull();
  });
  it("with rules shows the status line instead of the button", () => {
    render(<SetupProgressBar pct={75} checks={checks} status="3 rules active – Coverage 60%" />);
    expect(screen.getByTestId("status-line").textContent).toBe("3 rules active – Coverage 60%");
    expect(screen.queryByText(/Policy Template/i)).toBeNull();
  });
  it("stays visible at 100% so the status is always there", () => {
    render(<SetupProgressBar pct={100} checks={checks} status="1 rule active – Coverage 100%" />);
    expect(screen.getByTestId("setup-status")).toBeTruthy();
  });
});

describe("RuleCoverageHealthCard", () => {
  const cells = [{ kind: "send_email", provider: "gmail", status: "gap" as const }];
  it("keeps the coverage and health readouts in the header, still clickable", () => {
    const onCoverageClick = vi.fn();
    const onHealthClick = vi.fn();
    render(
      <RuleCoverageHealthCard coveragePct={80} coverageGapCount={1} coverageTotal={5} coverageCells={cells} healthPct={95}
        onCoverageClick={onCoverageClick} onHealthClick={onHealthClick} />,
    );
    const overlay = screen.getByTestId("coverage-overlay");
    expect(overlay.className).not.toMatch(/absolute/);
    fireEvent.click(screen.getByText("Coverage 80%"));
    fireEvent.click(screen.getByText("Health 95%"));
    expect(onCoverageClick).toHaveBeenCalled();
    expect(onHealthClick).toHaveBeenCalled();
  });
  it("shows a helpful empty state and no honeycomb when nothing is connected", () => {
    const onConnect = vi.fn();
    render(
      <RuleCoverageHealthCard coveragePct={null} coverageGapCount={0} coverageTotal={0} coverageCells={[]} healthPct={null}
        onCoverageClick={() => {}} onHealthClick={() => {}} onConnect={onConnect} />,
    );
    expect(screen.getByTestId("coverage-empty")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /coverage map/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /connect one/i }));
    expect(onConnect).toHaveBeenCalled();
  });
  it("keeps the honeycomb out of the page until Advanced is opened", () => {
    render(
      <RuleCoverageHealthCard coveragePct={0} coverageGapCount={1} coverageTotal={1} coverageCells={cells} healthPct={90}
        onCoverageClick={() => {}} onHealthClick={() => {}} />,
    );
    expect(screen.queryByTestId("coverage-map-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /coverage map/i }));
    expect(screen.getByTestId("coverage-map-dialog")).toBeTruthy();
  });
});
