import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { pollDelay, POLL_FAST_MS, POLL_SLOW_MS, POLL_MAX_MS } from "@/lib/poll";
import { usePoller } from "@/hooks/usePoller";

describe("pollDelay", () => {
  it("3 s while something runs, 15 s while only waiting for a person", () => {
    expect(pollDelay(true, 0)).toBe(POLL_FAST_MS);
    expect(pollDelay(false, 0)).toBe(POLL_SLOW_MS);
  });
  it("doubles after each failure in a row and stops at a minute", () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => pollDelay(true, n))).toEqual([3000, 6000, 12000, 24000, 48000, 60000]);
    expect(pollDelay(false, 9)).toBe(POLL_MAX_MS);
  });
  it("odd input never gives a shorter wait", () => {
    expect(pollDelay(true, -4)).toBe(POLL_FAST_MS);
    expect(pollDelay(true, Number.NaN)).toBeGreaterThanOrEqual(POLL_FAST_MS);
  });
});

describe("usePoller", () => {
  const setHidden = (h: boolean) => {
    Object.defineProperty(document, "visibilityState", { value: h ? "hidden" : "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  beforeEach(() => { vi.useFakeTimers(); setHidden(false); });
  afterEach(() => { vi.useRealTimers(); setHidden(false); });

  it("refreshes every 3 s while something runs, and not at all when nothing is open", async () => {
    const run = vi.fn(async () => true);
    const { rerender, unmount } = renderHook(({ active }) => usePoller(run, { active, fast: true }), { initialProps: { active: false } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).not.toHaveBeenCalled();
    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(run).toHaveBeenCalledTimes(3);
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("never starts a refresh while the last one is still running", async () => {
    let inFlight = 0; let maxInFlight = 0;
    const run = vi.fn(async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 10_000)); inFlight--; return true; });
    renderHook(() => usePoller(run, { active: true, fast: true }));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(maxInFlight).toBe(1);
  });

  it("slows down after failures and returns to normal after a success", async () => {
    let ok = false;
    const run = vi.fn(async () => ok);
    renderHook(() => usePoller(run, { active: true, fast: true }));
    await vi.advanceTimersByTimeAsync(3_000); // 1st, fails -> next in 6 s
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000); // 2nd, fails -> next in 12 s
    expect(run).toHaveBeenCalledTimes(2);
    ok = true;
    await vi.advanceTimersByTimeAsync(12_000); // 3rd, succeeds -> next in 3 s
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("a throwing refresh counts as a failure and never breaks the loop", async () => {
    const run = vi.fn(async () => { throw new Error("offline"); });
    renderHook(() => usePoller(run, { active: true, fast: true }));
    await vi.advanceTimersByTimeAsync(3_000 + 6_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("asks for nothing while the tab is hidden and refreshes once when it comes back", async () => {
    const run = vi.fn(async () => true);
    renderHook(() => usePoller(run, { active: true, fast: true }));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(1);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("uses the slower rhythm when only waiting for a person", async () => {
    const run = vi.fn(async () => true);
    renderHook(() => usePoller(run, { active: true, fast: false }));
    await vi.advanceTimersByTimeAsync(14_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
