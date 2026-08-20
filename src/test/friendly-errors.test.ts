import { describe, it, expect } from "vitest";
import { friendlyErrorMessage } from "@/lib/friendly-errors";

describe("friendlyErrorMessage", () => {
  it("rewrites a Postgres RLS violation into a plain-English message", () => {
    const raw = 'new row violates row-level security policy for table "hard_rules"';
    expect(friendlyErrorMessage(raw)).toBe("You don't have permission to do that on this account.");
  });

  it("rewrites a generic 'permission denied' message the same way", () => {
    expect(friendlyErrorMessage("permission denied for table hard_rules")).toBe("You don't have permission to do that on this account.");
  });

  it("is case-insensitive", () => {
    expect(friendlyErrorMessage("VIOLATES ROW-LEVEL SECURITY POLICY")).toBe("You don't have permission to do that on this account.");
  });

  it("leaves an unrelated error message unchanged", () => {
    expect(friendlyErrorMessage("duplicate key value violates unique constraint")).toBe("duplicate key value violates unique constraint");
  });

  it("handles an empty string without throwing", () => {
    expect(friendlyErrorMessage("")).toBe("");
  });
});
