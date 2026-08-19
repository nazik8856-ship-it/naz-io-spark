// Pure helpers for the governance-backup-export job: which tables get
// exported, where each export lands in storage, and which dated folders
// are old enough to prune. No Supabase client dependency so this can be
// unit tested directly.

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
