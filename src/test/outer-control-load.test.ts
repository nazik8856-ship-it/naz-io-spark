import { describe, it, expect } from "vitest";
import { loadVerdict, loadErrorText, failureText, PAGE_LOAD_TIMEOUT_MS } from "@/lib/outer-control-load";
import { TimeoutError } from "@/lib/with-timeout";

const ok = { error: null };
describe("what a failed read means for the Outer Control page", () => {
  it("all reads fine: opens normally", () => {
    expect(loadVerdict({ tools: ok, keys: ok, evals: ok })).toEqual({ blocking: null, feedFailed: false });
  });
  it("a failed connections or keys read blocks the page with a retry, never 'set up your first key'", () => {
    expect(loadVerdict({ tools: { error: { message: "x" } }, keys: ok, evals: ok }).blocking).toMatch(/could not read your connections/);
    expect(loadVerdict({ tools: ok, keys: { error: { message: "x" } }, evals: ok }).blocking).toMatch(/could not read your connections/);
  });
  it("a timed-out read says it was too slow", () => {
    expect(loadVerdict({ tools: ok, keys: { error: { code: "timeout", message: "slow" } }, evals: ok }).blocking).toMatch(/took too long/);
  });
  it("a failed activity feed only costs the feed", () => {
    expect(loadVerdict({ tools: ok, keys: ok, evals: { error: { message: "x" } } })).toEqual({ blocking: null, feedFailed: true });
  });
  it("missing results are treated as readable (head requests return no rows)", () => {
    expect(loadVerdict({ tools: undefined, keys: ok, evals: null })).toEqual({ blocking: null, feedFailed: false });
  });
  it("a thrown error and a timeout have their own wording and never leak raw text", () => {
    expect(loadErrorText(new TimeoutError("Loading", 25000))).toBe(failureText("timeout"));
    expect(loadErrorText(new Error("TypeError at 10.0.0.4 secret=abc"))).toBe(failureText("unexpected"));
    expect(PAGE_LOAD_TIMEOUT_MS).toBeGreaterThan(15_000); // longer than one read, so a slow read reports itself first
  });
});
