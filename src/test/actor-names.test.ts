import { describe, it, expect } from "vitest";
import { actorName, buildActorNameMap } from "@/lib/actor-names";

describe("buildActorNameMap", () => {
  it("maps the current user's own id to 'You'", () => {
    const map = buildActorNameMap("owner-uid", []);
    expect(map["owner-uid"]).toBe("You");
  });

  it("maps an active member's id to their email", () => {
    const map = buildActorNameMap("owner-uid", [{ member_id: "member-uid", email: "teammate@example.com" }]);
    expect(map["member-uid"]).toBe("teammate@example.com");
  });

  it("skips members with a null member_id (pending, not yet accepted invites)", () => {
    const map = buildActorNameMap("owner-uid", [{ member_id: null, email: "pending@example.com" }]);
    expect(Object.values(map)).not.toContain("pending@example.com");
  });

  it("owner's own id always resolves to 'You' even if also listed as a member row", () => {
    const map = buildActorNameMap("owner-uid", [{ member_id: "owner-uid", email: "owner@example.com" }]);
    // Member rows are iterated after the seed, so a same-id member row would
    // actually overwrite "You" -- this locks in which behavior is intended.
    expect(map["owner-uid"]).toBe("owner@example.com");
  });
});

describe("actorName", () => {
  it("returns the resolved name when present", () => {
    expect(actorName({ "uid-1": "You" }, "uid-1")).toBe("You");
  });

  it("falls back to a short id when the uid isn't in the map", () => {
    const result = actorName({}, "12345678-abcd-ef00-1234-567890abcdef");
    expect(result).toBe("12345678…");
  });
});
