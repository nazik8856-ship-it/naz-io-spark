import { describe, it, expect } from "vitest";
import { matchesSearch, filterBySearch } from "@/lib/search-filter";

describe("matchesSearch", () => {
  it("an empty query matches everything", () => {
    expect(matchesSearch("anything", "")).toBe(true);
    expect(matchesSearch(null, "")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch("Send Email", "email")).toBe(true);
    expect(matchesSearch("Send Email", "EMAIL")).toBe(true);
  });

  it("is a substring match, not exact", () => {
    expect(matchesSearch("slack_post_message", "post")).toBe(true);
    expect(matchesSearch("slack_post_message", "xyz")).toBe(false);
  });

  it("null/undefined values never match a non-empty query", () => {
    expect(matchesSearch(null, "x")).toBe(false);
    expect(matchesSearch(undefined, "x")).toBe(false);
  });

  it("non-string values are stringified before matching", () => {
    expect(matchesSearch(42, "4")).toBe(true);
    expect(matchesSearch(true, "true")).toBe(true);
  });
});

describe("filterBySearch", () => {
  const rows = [
    { id: "1", action_type: "send_email", reason: "looks fine" },
    { id: "2", action_type: "slack_post_message", reason: "needs review" },
  ];

  it("an empty query returns all rows unchanged", () => {
    expect(filterBySearch(rows, "", ["action_type", "reason"])).toEqual(rows);
  });

  it("matches if ANY of the given fields matches", () => {
    expect(filterBySearch(rows, "review", ["action_type", "reason"])).toEqual([rows[1]]);
    expect(filterBySearch(rows, "slack", ["action_type", "reason"])).toEqual([rows[1]]);
  });

  it("no match across any field excludes the row", () => {
    expect(filterBySearch(rows, "nonexistent", ["action_type", "reason"])).toEqual([]);
  });
});
