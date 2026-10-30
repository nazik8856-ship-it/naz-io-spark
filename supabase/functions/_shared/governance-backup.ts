// Pure helpers for the governance-backup-export job: which tables get
// exported, where each export lands in storage, and which dated folders
// are old enough to prune. No Supabase client dependency so this can be
// unit tested directly.
import { decryptField, encryptField, needsReencrypt, type FieldKeys, type FieldRef } from "./field-crypto.ts";

export const BACKUP_TABLES = [
  "agent_decisions",
  "pending_approvals",
  "hard_rules",
  "safety_rules",
  "policy_versions",
  "incidents",
  "config_changes",
] as const;

export type BackupTable = typeof BACKUP_TABLES[number];

export function backupObjectPath(dateStr: string, table: string): string {
  return `${dateStr}/${table}.json`;
}

export function todayUtcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const DATE_FOLDER_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A dated backup folder (name = "YYYY-MM-DD") is expired once its date is
 * older than `retentionDays` before `now`. Anything that isn't a
 * recognizable YYYY-MM-DD name is left alone rather than risk deleting
 * something this job didn't create.
 */
export function isExpiredBackupFolder(folderName: string, now: Date, retentionDays: number): boolean {
  if (!DATE_FOLDER_RE.test(folderName)) return false;
  const folderDate = new Date(`${folderName}T00:00:00Z`);
  if (Number.isNaN(folderDate.getTime())) return false;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return folderDate.getTime() < cutoff.getTime();
}

// ---------------------------------------------------------------------------------------
// Data encryption, front 5: each backup file is encrypted with DATA_KEY before it is uploaded (AES-256-GCM, field-crypto.ts),
// bound to its storage path, so a file copied or renamed to another path does not decrypt. The file holds one value in the
// usual "v2:<key id>:<iv>:<ciphertext>" form. scripts/decrypt-backup.ts turns a downloaded file back into its JSON.

export function encryptedBackupPath(dateStr: string, table: string): string {
  return `${backupObjectPath(dateStr, table)}.enc`;
}

const backupRef = (path: string): FieldRef => ({ table: "governance-backups", column: "file", id: path });

export function sealBackup(keys: FieldKeys, path: string, json: string): Promise<string> {
  return encryptField(keys, backupRef(path), json);
}

/** The JSON back; throws when the file was changed, moved to another path, or no configured key encrypted it. */
export function openBackup(keys: FieldKeys, path: string, stored: string): Promise<string> {
  return decryptField(keys, backupRef(path), stored.trim());
}

/** What a stored file needs: "encrypt" (a plain .json from before), "rekey" (encrypted with a previous key), or nothing. */
export function backupFileAction(keys: FieldKeys, name: string, firstBytes: string | null): "encrypt" | "rekey" | null {
  if (/\.json$/.test(name)) return "encrypt";
  if (/\.json\.enc$/.test(name) && firstBytes !== null && needsReencrypt(keys, firstBytes)) return "rekey";
  return null;
}

/** The storage path a downloaded file came from: its last two parts, "<date>/<table>.json.enc" (what it is bound to). */
export function backupStoragePath(localFile: string): string {
  const parts = localFile.replace(/\\/g, "/").split("/").filter(Boolean);
  const path = parts.slice(-2).join("/");
  if (!/^\d{4}-\d{2}-\d{2}\/[a-z_]+\.json\.enc$/.test(path)) throw new Error(`expected a file at <date>/<table>.json.enc, got ${localFile}`);
  return path;
}
