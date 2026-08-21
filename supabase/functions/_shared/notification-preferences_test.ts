// Real tests for per-user notification recipient resolution.
//
// Run with: deno test --allow-none supabase/functions/_shared/notification-preferences_test.ts
import { resolveNotificationRecipients } from "./notification-preferences.ts";

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
