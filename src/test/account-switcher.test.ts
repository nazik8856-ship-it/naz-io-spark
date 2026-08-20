import { describe, it, expect } from "vitest";
import { buildAccountOptions, resolveActiveAccountId, roleForAccount, canWriteAsOwner, canApprove } from "@/lib/account-switcher";

describe("buildAccountOptions", () => {
  it("always includes the user's own account first, labeled 'My account'", () => {
    const opts = buildAccountOptions("self-uid", [], {});
    expect(opts).toEqual([{ accountId: "self-uid", role: "self", label: "My account" }]);
  });

  it("adds one option per active membership with the membership's role", () => {
    const opts = buildAccountOptions("self-uid", [{ account_owner_id: "owner-uid", role: "approver" }], {});
    expect(opts[1]).toEqual({ accountId: "owner-uid", role: "approver", label: "owner-ui…" });
  });

  it("uses the resolved owner name when available instead of a truncated id", () => {
    const opts = buildAccountOptions("self-uid", [{ account_owner_id: "owner-uid", role: "owner" }], { "owner-uid": "Acme Inc" });
    expect(opts[1].label).toBe("Acme Inc");
  });
});

describe("resolveActiveAccountId", () => {
  const options = [
    { accountId: "self-uid", role: "self" as const, label: "My account" },
    { accountId: "owner-uid", role: "viewer" as const, label: "Acme" },
  ];

  it("keeps the stored selection when it's still a valid option", () => {
    expect(resolveActiveAccountId("owner-uid", options, "self-uid")).toBe("owner-uid");
  });

  it("falls back to the user's own account when nothing is stored", () => {
    expect(resolveActiveAccountId(null, options, "self-uid")).toBe("self-uid");
  });

  it("falls back to the user's own account when the stored id is no longer valid (e.g. revoked membership)", () => {
    expect(resolveActiveAccountId("revoked-owner-uid", options, "self-uid")).toBe("self-uid");
  });
});

describe("roleForAccount", () => {
  const options = [
    { accountId: "self-uid", role: "self" as const, label: "My account" },
    { accountId: "owner-uid", role: "approver" as const, label: "Acme" },
  ];

  it("returns the matching option's role", () => {
    expect(roleForAccount(options, "owner-uid")).toBe("approver");
  });

  it("defaults to 'self' for an unrecognized account id", () => {
    expect(roleForAccount(options, "unknown-uid")).toBe("self");
  });
});

describe("canWriteAsOwner", () => {
  it("allows self and owner", () => {
    expect(canWriteAsOwner("self")).toBe(true);
    expect(canWriteAsOwner("owner")).toBe(true);
  });
  it("denies approver and viewer", () => {
    expect(canWriteAsOwner("approver")).toBe(false);
    expect(canWriteAsOwner("viewer")).toBe(false);
  });
});

describe("canApprove", () => {
  it("allows self, owner, and approver", () => {
    expect(canApprove("self")).toBe(true);
    expect(canApprove("owner")).toBe(true);
    expect(canApprove("approver")).toBe(true);
  });
  it("denies viewer", () => {
    expect(canApprove("viewer")).toBe(false);
  });
});
