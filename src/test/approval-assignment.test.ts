import { describe, it, expect } from "vitest";
import { suggestAssignee, isOutOfOffice } from "@/lib/approval-assignment";

describe("isOutOfOffice", () => {
  it("no ooo_until at all is not OOO", () => {
    expect(isOutOfOffice(null)).toBe(false);
    expect(isOutOfOffice(undefined)).toBe(false);
  });

  it("an ooo_until in the future is OOO", () => {
    expect(isOutOfOffice("2026-09-01T00:00:00Z", new Date("2026-08-21T00:00:00Z"))).toBe(true);
  });

  it("an ooo_until in the past is not OOO anymore", () => {
    expect(isOutOfOffice("2026-08-01T00:00:00Z", new Date("2026-08-21T00:00:00Z"))).toBe(false);
  });
});

describe("suggestAssignee", () => {
  const NOW = new Date("2026-08-21T00:00:00Z");

  it("suggests the candidate with the fewest open approvals", () => {
    const result = suggestAssignee(
      [{ memberId: "busy", openCount: 5 }, { memberId: "free", openCount: 1 }],
      NOW,
    );
    expect(result).toBe("free");
  });

  it("skips a candidate who is currently out of office", () => {
    const result = suggestAssignee(
      [
        { memberId: "ooo-but-free", openCount: 0, oooUntil: "2026-09-01T00:00:00Z" },
        { memberId: "available", openCount: 3 },
      ],
      NOW,
    );
    expect(result).toBe("available");
  });

  it("ties are broken deterministically by memberId", () => {
    const result = suggestAssignee(
      [{ memberId: "zzz", openCount: 2 }, { memberId: "aaa", openCount: 2 }],
      NOW,
    );
    expect(result).toBe("aaa");
  });

  it("returns null when every candidate is out of office", () => {
    const result = suggestAssignee(
      [{ memberId: "a", openCount: 0, oooUntil: "2026-09-01T00:00:00Z" }],
      NOW,
    );
    expect(result).toBeNull();
  });

  it("returns null with no candidates at all", () => {
    expect(suggestAssignee([], NOW)).toBeNull();
  });

  it("an OOO date already in the past no longer excludes the candidate", () => {
    const result = suggestAssignee(
      [{ memberId: "back-now", openCount: 0, oooUntil: "2026-08-01T00:00:00Z" }],
      NOW,
    );
    expect(result).toBe("back-now");
  });
});
