// Real tests for the governance-backup-export pure helpers.
//
// Run with: deno test --allow-none supabase/functions/_shared/governance-backup_test.ts
import { backupFileAction, backupObjectPath, backupStoragePath, BACKUP_TABLES, encryptedBackupPath, isExpiredBackupFolder, openBackup, sealBackup, todayUtcDateString } from "./governance-backup.ts";
import { importFieldKeys, toB64 } from "./field-crypto.ts";

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

// ---- Data encryption, front 5: encrypted backup files ----

const KEYS = (await importFieldKeys(toB64(new Uint8Array(32).fill(7))))!;
const OTHER = (await importFieldKeys(toB64(new Uint8Array(32).fill(8))))!;
const ROTATED = (await importFieldKeys(toB64(new Uint8Array(32).fill(8)), toB64(new Uint8Array(32).fill(7))))!;
async function rejects(p: Promise<unknown>, what: string) { try { await p; } catch { return; } throw new Error(`expected a failure: ${what}`); }

Deno.test("an encrypted backup file is only ciphertext and opens back to the same JSON", async () => {
  const path = encryptedBackupPath("2026-10-30", "pending_approvals");
  assertEquals(path, "2026-10-30/pending_approvals.json.enc");
  const json = JSON.stringify([{ id: "a1", description: "Refund order 1042 to jane@example.com" }]);
  const stored = await sealBackup(KEYS, path, json);
  assertEquals(stored.startsWith("v2:"), true);
  assertEquals(stored.includes("jane") || stored.includes("Refund"), false, "no plain text in the file");
  assertEquals(await openBackup(KEYS, path, stored + "\n"), json);
});

Deno.test("a backup file does not open at another path, with another key, or when changed", async () => {
  const path = encryptedBackupPath("2026-10-30", "hard_rules");
  const stored = await sealBackup(KEYS, path, "[]");
  await rejects(openBackup(KEYS, encryptedBackupPath("2026-10-29", "hard_rules"), stored), "another path");
  await rejects(openBackup(OTHER, path, stored), "another key");
  await rejects(openBackup(KEYS, path, stored.slice(0, -4) + "AAAA"), "changed");
  assertEquals(await openBackup(ROTATED, path, stored), "[]", "still opens during a rotation, with the old key as previous");
});

Deno.test("backupFileAction: plain files are encrypted, files on an old key re-encrypted, current ones left alone", async () => {
  const current = await sealBackup(KEYS, "x", "[]");
  assertEquals(backupFileAction(KEYS, "hard_rules.json", null), "encrypt");
  assertEquals(backupFileAction(KEYS, "hard_rules.json.enc", current.slice(0, 40)), null);
  assertEquals(backupFileAction(ROTATED, "hard_rules.json.enc", current.slice(0, 40)), "rekey");
  assertEquals(backupFileAction(KEYS, "notes.txt", null), null, "anything this job did not write is left alone");
});

Deno.test("backupStoragePath: a downloaded file is opened at the path it was stored at", () => {
  assertEquals(backupStoragePath("/home/me/Downloads/backups/2026-10-30/hard_rules.json.enc"), "2026-10-30/hard_rules.json.enc");
  assertEquals(backupStoragePath("C:\\backups\\2026-10-30\\agent_decisions.json.enc"), "2026-10-30/agent_decisions.json.enc");
  let threw = false;
  try { backupStoragePath("hard_rules.json.enc"); } catch { threw = true; }
  assertEquals(threw, true, "a file outside its dated folder is refused");
});
