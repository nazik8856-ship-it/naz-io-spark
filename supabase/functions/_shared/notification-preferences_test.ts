// Real tests for per-user notification recipient resolution.
//
// Run with: deno test --allow-none supabase/functions/_shared/notification-preferences_test.ts
import { resolveNotificationRecipients, resolveAssignedRecipient } from "./notification-preferences.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("the owner with no preference row gets it (preserves today's default behavior)", () => {
  const recipients = resolveNotificationRecipients("owner-1", "owner@x.com", [], [], "digest_enabled");
  assertEquals(recipients, [{ recipientId: "owner-1", email: "owner@x.com" }]);
});

Deno.test("the owner who explicitly opted out does not get it", () => {
  const recipients = resolveNotificationRecipients(
    "owner-1", "owner@x.com", [],
    [{ recipient_id: "owner-1", digest_enabled: false, weekly_trend_enabled: true }],
    "digest_enabled",
  );
  assertEquals(recipients, []);
});

Deno.test("a team member with no preference row does NOT get it (opt-in only, unlike the owner)", () => {
  const recipients = resolveNotificationRecipients(
    "owner-1", "owner@x.com",
    [{ member_id: "member-1", email: "teammate@x.com", status: "active" }],
    [],
    "digest_enabled",
  );
  assertEquals(recipients, [{ recipientId: "owner-1", email: "owner@x.com" }]);
});

Deno.test("a team member who explicitly opted in DOES get it", () => {
  const recipients = resolveNotificationRecipients(
    "owner-1", "owner@x.com",
    [{ member_id: "member-1", email: "teammate@x.com", status: "active" }],
    [{ recipient_id: "member-1", digest_enabled: true, weekly_trend_enabled: false }],
    "digest_enabled",
  );
  assertEquals(recipients, [{ recipientId: "owner-1", email: "owner@x.com" }, { recipientId: "member-1", email: "teammate@x.com" }]);
});

Deno.test("channels are independent -- opting into digest doesn't opt into weekly trend", () => {
  const recipients = resolveNotificationRecipients(
    "owner-1", "owner@x.com",
    [{ member_id: "member-1", email: "teammate@x.com", status: "active" }],
    [{ recipient_id: "member-1", digest_enabled: true, weekly_trend_enabled: false }],
    "weekly_trend_enabled",
  );
  assertEquals(recipients, [{ recipientId: "owner-1", email: "owner@x.com" }]);
});

Deno.test("a revoked (non-active) member never gets a notification, regardless of any stale preference row", () => {
  const recipients = resolveNotificationRecipients(
    "owner-1", "owner@x.com",
    [{ member_id: "member-1", email: "teammate@x.com", status: "revoked" }],
    [{ recipient_id: "member-1", digest_enabled: true, weekly_trend_enabled: true }],
    "digest_enabled",
  );
  assertEquals(recipients, [{ recipientId: "owner-1", email: "owner@x.com" }]);
});

Deno.test("a pending (not-yet-accepted) member never gets a notification", () => {
  const recipients = resolveNotificationRecipients(
    "owner-1", "owner@x.com",
    [{ member_id: null, email: "invited-not-yet-joined@x.com", status: "pending" }],
    [],
    "digest_enabled",
  );
  assertEquals(recipients, [{ recipientId: "owner-1", email: "owner@x.com" }]);
});

Deno.test("no owner email on file and nobody opted in is an empty recipient list, not a crash", () => {
  assertEquals(resolveNotificationRecipients("owner-1", null, [], [], "digest_enabled"), []);
});

Deno.test("critical_alert_email_enabled: the owner with no preference row gets it, same as digest_enabled", () => {
  const recipients = resolveNotificationRecipients("owner-1", "owner@x.com", [], [], "critical_alert_email_enabled");
  assertEquals(recipients, [{ recipientId: "owner-1", email: "owner@x.com" }]);
});

Deno.test("critical_alert_email_enabled: a team member who explicitly opted in DOES get it", () => {
  const recipients = resolveNotificationRecipients(
    "owner-1", "owner@x.com",
    [{ member_id: "member-1", email: "teammate@x.com", status: "active" }],
    [{ recipient_id: "member-1", digest_enabled: false, weekly_trend_enabled: false, critical_alert_email_enabled: true }],
    "critical_alert_email_enabled",
  );
  assertEquals(recipients, [{ recipientId: "owner-1", email: "owner@x.com" }, { recipientId: "member-1", email: "teammate@x.com" }]);
});

// ---- resolveAssignedRecipient (Pillar 4) -----------------------------------
// An approval's assigned_to is a real, human-set delegation, but nothing
// that actually sends a notification looked at it -- these exercise the
// OOO+fallback redirect logic, re-checked at notification time (not merely
// trusted from whenever the assignment itself was made).

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

class FakeMemberQuery {
  filters: Record<string, unknown> = {};
  constructor(private rows: AnyRow[]) {}
  select() { return this; }
  eq(col: string, val: unknown) { this.filters[col] = val; return this; }
  async maybeSingle() {
    const row = this.rows.find((r) => Object.entries(this.filters).every(([k, v]) => r[k] === v));
    return { data: row ?? null, error: null };
  }
}

function fakeAdminFor(accountMembers: AnyRow[], ownerEmail: string | null = "owner@x.com") {
  return {
    auth: { admin: { getUserById: async (_id: string) => ({ data: { user: ownerEmail ? { email: ownerEmail } : null } }) } },
    from(table: string) {
      if (table === "account_members") return new FakeMemberQuery(accountMembers);
      return new FakeMemberQuery([]);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("resolveAssignedRecipient: no assignee at all resolves to null", async () => {
  const admin = fakeAdminFor([]);
  assertEquals(await resolveAssignedRecipient(admin, "owner-1", null), null);
  assertEquals(await resolveAssignedRecipient(admin, "owner-1", undefined), null);
});

Deno.test("resolveAssignedRecipient: assigned to the account owner resolves their own email", async () => {
  const admin = fakeAdminFor([], "owner@x.com");
  const recipient = await resolveAssignedRecipient(admin, "owner-1", "owner-1");
  assertEquals(recipient, { recipientId: "owner-1", email: "owner@x.com" });
});

Deno.test("resolveAssignedRecipient: an active, non-OOO member resolves to themself", async () => {
  const admin = fakeAdminFor([
    { account_owner_id: "owner-1", member_id: "member-1", email: "reviewer@x.com", status: "active", ooo_until: null, ooo_fallback_member_id: null },
  ]);
  const recipient = await resolveAssignedRecipient(admin, "owner-1", "member-1");
  assertEquals(recipient, { recipientId: "member-1", email: "reviewer@x.com" });
});

Deno.test("resolveAssignedRecipient: an OOO member with a valid active fallback redirects to the fallback", async () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdminFor([
    { account_owner_id: "owner-1", member_id: "member-1", email: "reviewer@x.com", status: "active", ooo_until: future, ooo_fallback_member_id: "member-2" },
    { account_owner_id: "owner-1", member_id: "member-2", email: "fallback@x.com", status: "active" },
  ]);
  const recipient = await resolveAssignedRecipient(admin, "owner-1", "member-1");
  assertEquals(recipient, { recipientId: "member-2", email: "fallback@x.com" });
});

Deno.test("resolveAssignedRecipient: OOO with a fallback that is no longer active falls back to the original assignee", async () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdminFor([
    { account_owner_id: "owner-1", member_id: "member-1", email: "reviewer@x.com", status: "active", ooo_until: future, ooo_fallback_member_id: "member-2" },
  ]);
  const recipient = await resolveAssignedRecipient(admin, "owner-1", "member-1");
  assertEquals(recipient, { recipientId: "member-1", email: "reviewer@x.com" });
});

Deno.test("resolveAssignedRecipient: an OOO period that has already ended is not redirected", async () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdminFor([
    { account_owner_id: "owner-1", member_id: "member-1", email: "reviewer@x.com", status: "active", ooo_until: past, ooo_fallback_member_id: "member-2" },
    { account_owner_id: "owner-1", member_id: "member-2", email: "fallback@x.com", status: "active" },
  ]);
  const recipient = await resolveAssignedRecipient(admin, "owner-1", "member-1");
  assertEquals(recipient, { recipientId: "member-1", email: "reviewer@x.com" });
});

Deno.test("resolveAssignedRecipient: assigned to a member who is no longer active resolves to null", async () => {
  const admin = fakeAdminFor([
    { account_owner_id: "owner-1", member_id: "member-1", email: "reviewer@x.com", status: "revoked", ooo_until: null, ooo_fallback_member_id: null },
  ]);
  assertEquals(await resolveAssignedRecipient(admin, "owner-1", "member-1"), null);
});

Deno.test("resolveAssignedRecipient: OOO redirected to the account owner as fallback resolves the owner's email", async () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdminFor(
    [{ account_owner_id: "owner-1", member_id: "member-1", email: "reviewer@x.com", status: "active", ooo_until: future, ooo_fallback_member_id: "owner-1" }],
    "owner@x.com",
  );
  const recipient = await resolveAssignedRecipient(admin, "owner-1", "member-1");
  assertEquals(recipient, { recipientId: "owner-1", email: "owner@x.com" });
});
