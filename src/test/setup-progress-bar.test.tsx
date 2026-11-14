import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RuleCoverageHealthCard from "@/components/control/dashboard/RuleCoverageHealthCard";

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
