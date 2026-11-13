import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout, fetchWithTimeout, TimeoutError, isTimeout } from "@/lib/with-timeout";

afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
  it("passes a fast result through", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
  it("passes a fast failure through unchanged", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });
  it("rejects with a TimeoutError when nothing answers", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 5000, "Reading Outer Control");
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const e = await caught;
    expect(e).toBeInstanceOf(TimeoutError);
    expect(isTimeout(e)).toBe(true);
    expect((e as Error).message).toBe("Reading Outer Control took longer than 5 seconds.");
  });
  it("does not leave a timer behind after a fast answer", async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve(1), 5000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("fetchWithTimeout", () => {
  it("aborts a request that never answers and says it timed out", async () => {
    vi.useFakeTimers();
    const hung = ((_: unknown, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const caught = fetchWithTimeout(hung, "https://x.invalid", {}, 3000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(3000);
    expect(isTimeout(await caught)).toBe(true);
  });
  it("returns a normal answer and clears its timer", async () => {
    vi.useFakeTimers();
    const ok = (async () => new Response("{}")) as unknown as typeof fetch;
    const r = await fetchWithTimeout(ok, "https://x.invalid", {}, 3000);
    expect(r.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a network error that is not a timeout stays a network error", async () => {
    const bad = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    await expect(fetchWithTimeout(bad, "https://x.invalid", {}, 3000)).rejects.toThrow("network down");
  });
});
