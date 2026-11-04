// User & data isolation, older sites: sites generated before 2026-11-05 keep their pictures (and published copies of uploads) under
// mission-assets/website-images/<owner>/<site>/, so a public image address names the owner's account. Newer sites use
// website-images/<site>/ (the site id is random and says nothing about whose it is). site-images-cleanup-sweep moves each old folder
// with relocateSite():
//
//   1. the site must still exist and belong to the account the folder is named after (otherwise it is left alone: a deleted site's
//      files belong to the cleanup, a mismatch is a question for a person);
//   2. every file is copied to the new folder (a copy left by an earlier, interrupted run counts as done);
//   3. every stored address is rewritten in one database transaction (pages, the site's prompt, shared copies, saved versions);
//   4. the old files are removed only when no stored address points at the old folder any more.
//
// Any failure stops before the next step, so a site is never left pointing at files that are gone; the next run picks it up again.
import { listFiles, UUID, type Folder, type ListableStorage } from "./orphan-files.ts";

export type CopyStorage = ListableStorage & {
  copy: (from: string, to: string) => Promise<{ error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
};

export type LegacyFolder = { owner: string; site: string; folder: string };

export type RelocationDb = {
  /** The site's owner, or null when the site does not exist. Throws when the lookup fails. */
  ownerOf: (site: string) => Promise<string | null>;
  /** Rewrites `from` to `to` wherever the site's addresses are stored, in one transaction; returns the rows changed. */
  rewrite: (site: string, from: string, to: string) => Promise<number>;
  /** How many stored rows still contain `from`; null when unsure (treated as "still in use"). */
  refsLeft: (from: string) => Promise<number | null>;
};

export type RelocationStatus = "moved" | "would_move" | "empty" | "site_missing" | "owner_mismatch" | "copy_failed" | "refs_left" | "remove_failed";
export type RelocationResult = { site: string; status: RelocationStatus; files: number; copied: number; removed: number; rows_rewritten: number };

const ROOT = "website-images";
const REMOVE_CHUNK = 100;

/** The old-layout folders (website-images/<owner>/<site>) among the site folders the cleanup found. */
export function legacyFolders(folders: Folder[]): LegacyFolder[] {
  const out: LegacyFolder[] = [];
  for (const f of folders) {
    const parts = f.folder.split("/");
    if (parts.length === 3 && parts[0] === ROOT && UUID.test(parts[1]) && UUID.test(parts[2])) {
      out.push({ owner: parts[1].toLowerCase(), site: parts[2].toLowerCase(), folder: f.folder });
    }
  }
  return out;
}

/** The address prefix stored in pages for an old folder, and the one it becomes. Both end with "/" so one site never matches another. */
export function prefixes(l: LegacyFolder): { from: string; to: string } {
  return { from: `${l.folder}/`, to: `${ROOT}/${l.site}/` };
}

/** Where one file of an old folder goes; null for a path outside it. */
export function destinationFor(path: string, l: LegacyFolder): string | null {
  const { from, to } = prefixes(l);
  return path.startsWith(from) && path.length > from.length ? to + path.slice(from.length) : null;
}

export async function relocateSite(storage: CopyStorage, db: RelocationDb, l: LegacyFolder, opts: { dryRun?: boolean } = {}): Promise<RelocationResult> {
  const res: RelocationResult = { site: l.site, status: "moved", files: 0, copied: 0, removed: 0, rows_rewritten: 0 };
  const owner = await db.ownerOf(l.site);
  if (owner === null) return { ...res, status: "site_missing" };
  if (owner.toLowerCase() !== l.owner) return { ...res, status: "owner_mismatch" };

  const files = await listFiles(storage, l.folder);
  res.files = files.length;
  if (!files.length) return { ...res, status: "empty" };
  if (opts.dryRun) return { ...res, status: "would_move" };

  for (const f of files) {
    const to = destinationFor(f.path, l);
    if (!to) return { ...res, status: "copy_failed" };
    const { error } = await storage.copy(f.path, to);
    // A copy made by an earlier run that stopped half way is already there.
    if (error && !/already exists|duplicate/i.test(error.message)) return { ...res, status: "copy_failed" };
    res.copied++;
  }

  const { from, to } = prefixes(l);
  res.rows_rewritten = await db.rewrite(l.site, from, to);
  const left = await db.refsLeft(from);
  if (left === null || left > 0) return { ...res, status: "refs_left" };

  const paths = files.map((f) => f.path);
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK);
    const { error } = await storage.remove(chunk);
    if (error) return { ...res, status: "remove_failed" };
    res.removed += chunk.length;
  }
  return res;
}
