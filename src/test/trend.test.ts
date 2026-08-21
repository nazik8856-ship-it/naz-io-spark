import { describe, it, expect } from "vitest";
import { computeTrend } from "@/lib/trend";

describe("computeTrend", () => {
  it("an increase is 'up' with a positive percent change", () => {
    expect(computeTrend(15, 10)).toEqual({ current: 15, previous: 10, changePct: 50, direction: "up" });
  });

  it("a decrease is 'down' with a negative percent change", () => {
    expect(computeTrend(5, 10)).toEqual({ current: 5, previous: 10, changePct: -50, direction: "down" });
  });

  it("no change is 'flat' with 0% change", () => {
    expect(computeTrend(10, 10)).toEqual({ current: 10, previous: 10, changePct: 0, direction: "flat" });
  });

  it("zero both periods is flat with 0% change, not NaN/Infinity", () => {
    expect(computeTrend(0, 0)).toEqual({ current: 0, previous: 0, changePct: 0, direction: "flat" });
  });

  it("going from zero to something is 'up' with 100% change (no prior baseline to divide by)", () => {
    expect(computeTrend(5, 0)).toEqual({ current: 5, previous: 0, changePct: 100, direction: "up" });
  });

  it("going from something to zero is 'down' with -100% change", () => {
    expect(computeTrend(0, 5)).toEqual({ current: 0, previous: 5, changePct: -100, direction: "down" });
  });

  it("percent change rounds to one decimal place", () => {
    expect(computeTrend(1, 3).changePct).toBe(-66.7);
  });
});
