// Real tests for the governance-backup-export pure helpers.
//
// Run with: deno test --allow-none supabase/functions/_shared/governance-backup_test.ts
import { backupObjectPath, BACKUP_TABLES, isExpiredBackupFolder, todayUtcDateString } from "./governance-backup.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("backupObjectPath builds a dated per-table key", () => {
  assertEquals(backupObjectPath("2026-08-19", "agent_decisions"), "2026-08-19/agent_decisions.json");
});

Deno.test("todayUtcDateString formats as YYYY-MM-DD in UTC", () => {
  assertEquals(todayUtcDateString(new Date("2026-08-19T23:59:00Z")), "2026-08-19");
  assertEquals(todayUtcDateString(new Date("2026-01-01T00:00:00Z")), "2026-01-01");
});

Deno.test("BACKUP_TABLES covers the core governance tables", () => {
  assertEquals(BACKUP_TABLES.includes("agent_decisions"), true);
  assertEquals(BACKUP_TABLES.includes("pending_approvals"), true);
  assertEquals(BACKUP_TABLES.includes("hard_rules"), true);
  assertEquals(BACKUP_TABLES.includes("safety_rules"), true);
  assertEquals(BACKUP_TABLES.includes("policy_versions"), true);
  assertEquals(BACKUP_TABLES.includes("incidents"), true);
  assertEquals(BACKUP_TABLES.includes("config_changes"), true);
});

Deno.test("isExpiredBackupFolder: folder older than retention window is expired", () => {
  const now = new Date("2026-08-19T00:00:00Z");
  assertEquals(isExpiredBackupFolder("2026-07-01", now, 30), true);
});

Deno.test("isExpiredBackupFolder: folder inside retention window is not expired", () => {
  const now = new Date("2026-08-19T00:00:00Z");
  assertEquals(isExpiredBackupFolder("2026-08-10", now, 30), false);
});

Deno.test("isExpiredBackupFolder: exactly at the cutoff boundary is not yet expired", () => {
  const now = new Date("2026-08-19T00:00:00Z");
  // cutoff = now - 30d = 2026-07-20T00:00:00Z; a folder dated exactly there
  // is not strictly older than the cutoff.
  assertEquals(isExpiredBackupFolder("2026-07-20", now, 30), false);
});

Deno.test("isExpiredBackupFolder: one day past the cutoff is expired", () => {
  const now = new Date("2026-08-19T00:00:00Z");
  assertEquals(isExpiredBackupFolder("2026-07-19", now, 30), true);
});

Deno.test("isExpiredBackupFolder: ignores non-date-named entries", () => {
  const now = new Date("2026-08-19T00:00:00Z");
  assertEquals(isExpiredBackupFolder(".emptyFolderPlaceholder", now, 30), false);
  assertEquals(isExpiredBackupFolder("not-a-date", now, 30), false);
  assertEquals(isExpiredBackupFolder("2026-13-99", now, 30), false);
});
