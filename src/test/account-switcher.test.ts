import { describe, it, expect } from "vitest";
import { buildAccountOptions, resolveActiveAccountId, roleForAccount, permissionsForAccount, canWriteAsOwner, canApprove, hasPermission } from "@/lib/account-switcher";

describe("buildAccountOptions", () => {
  it("always includes the user's own account first, labeled 'My account', unrestricted", () => {
    const opts = buildAccountOptions("self-uid", [], {});
    expect(opts).toEqual([{ accountId: "self-uid", role: "self", label: "My account", permissions: null }]);
  });

  it("adds one option per active membership with the membership's role", () => {
    const opts = buildAccountOptions("self-uid", [{ account_owner_id: "owner-uid", role: "approver" }], {});
    expect(opts[1]).toEqual({ accountId: "owner-uid", role: "approver", label: "owner-ui…", permissions: null });
  });

  it("uses the resolved owner name when available instead of a truncated id", () => {
    const opts = buildAccountOptions("self-uid", [{ account_owner_id: "owner-uid", role: "owner" }], { "owner-uid": "Acme Inc" });
    expect(opts[1].label).toBe("Acme Inc");
  });

  it("carries a membership's narrowed permissions through", () => {
    const opts = buildAccountOptions("self-uid", [{ account_owner_id: "owner-uid", role: "owner", permissions: ["spend"] }], {});
    expect(opts[1].permissions).toEqual(["spend"]);
  });
});

describe("resolveActiveAccountId", () => {
  const options = [
    { accountId: "self-uid", role: "self" as const, label: "My account", permissions: null },
    { accountId: "owner-uid", role: "viewer" as const, label: "Acme", permissions: null },
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
    { accountId: "self-uid", role: "self" as const, label: "My account", permissions: null },
    { accountId: "owner-uid", role: "approver" as const, label: "Acme", permissions: null },
  ];

  it("returns the matching option's role", () => {
    expect(roleForAccount(options, "owner-uid")).toBe("approver");
  });

  it("defaults to 'self' for an unrecognized account id", () => {
    expect(roleForAccount(options, "unknown-uid")).toBe("self");
  });
});

describe("permissionsForAccount", () => {
  const options = [
    { accountId: "self-uid", role: "self" as const, label: "My account", permissions: null },
    { accountId: "owner-uid", role: "owner" as const, label: "Acme", permissions: ["policy"] },
  ];

  it("returns the matching option's permissions", () => {
    expect(permissionsForAccount(options, "owner-uid")).toEqual(["policy"]);
  });

  it("defaults to null for an unrecognized account id", () => {
    expect(permissionsForAccount(options, "unknown-uid")).toBe(null);
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

describe("hasPermission", () => {
  it("always allows the account's own self, regardless of any permissions array", () => {
    expect(hasPermission("self", [], "policy")).toBe(true);
    expect(hasPermission("self", null, "spend")).toBe(true);
  });

  it("allows an owner-role member with null permissions (unrestricted, the default)", () => {
    expect(hasPermission("owner", null, "policy")).toBe(true);
    expect(hasPermission("owner", undefined, "integrations")).toBe(true);
  });

  it("allows an owner-role member whose permissions include the requested category", () => {
    expect(hasPermission("owner", ["policy", "spend"], "policy")).toBe(true);
  });

  it("denies an owner-role member whose permissions DON'T include the requested category", () => {
    expect(hasPermission("owner", ["spend"], "policy")).toBe(false);
  });

  it("denies an owner-role member with an empty permissions array for any category", () => {
    expect(hasPermission("owner", [], "policy")).toBe(false);
    expect(hasPermission("owner", [], "spend")).toBe(false);
  });

  it("denies approver and viewer regardless of any permissions array", () => {
    expect(hasPermission("approver", null, "policy")).toBe(false);
    expect(hasPermission("viewer", ["policy", "spend", "integrations"], "policy")).toBe(false);
  });
});
