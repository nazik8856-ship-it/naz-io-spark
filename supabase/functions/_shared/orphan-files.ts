// User & data isolation, leftovers: files that outlive the thing they belonged to.
//
// A site's generated pictures and the copies of uploads it publishes are public files under mission-assets/website-images/. The site
// row can disappear in several ways (deleted in the app, rolled back by the generator, the whole account deleted), and none of them
// removed the files. A user's attached files (private bucket user-uploads) have the same problem when the account is deleted.
// site-images-cleanup-sweep uses this module to find them; it only plans, the sweep removes.
//
// A file is left alone when it could still matter: its site (or user) exists; a page, a saved version or a shared copy still points
// at it (a site can be copied, a share link outlives the site on purpose); or it is newer than the grace period.

export type StorageEntry = { name: string; id: string | null; created_at?: string | null; updated_at?: string | null };
export type ListableStorage = {
  list: (path: string, o: { limit: number; offset: number }) => Promise<{ data: StorageEntry[] | null; error: { message: string } | null }>;
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 100;
const MAX_ENTRIES = 5000; // per folder: a listing that never ends can not hold the sweep up
const MAX_DEPTH = 4;

/** A folder has no id in a storage listing; a file does. */
export const isFolder = (e: StorageEntry) => e.id === null || e.id === undefined;

export async function listAll(storage: ListableStorage, path: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = [];
  for (let offset = 0; offset < MAX_ENTRIES; offset += PAGE) {
    const { data, error } = await storage.list(path, { limit: PAGE, offset });
    if (error) throw new Error(`could not list ${path}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

export type FileRef = { path: string; at: number };

/** Every file below a folder (folders inside it are followed, up to a few levels). */
export async function listFiles(storage: ListableStorage, path: string, depth = 0): Promise<FileRef[]> {
  if (depth > MAX_DEPTH) return [];
  const files: FileRef[] = [];
  for (const e of await listAll(storage, path)) {
    const child = path ? `${path}/${e.name}` : e.name;
    if (isFolder(e)) files.push(...(await listFiles(storage, child, depth + 1)));
    else files.push({ path: child, at: Date.parse(e.created_at ?? e.updated_at ?? "") || Date.now() });
  }
  return files;
}

export type Folder = { id: string; folder: string };

/**
 * The folders that stand for one site under `root`. Today a site's folder is website-images/<site>/ (its pictures, and uploads/ for
 * published copies of uploads). Sites generated before 2026-11-05 are website-images/<user>/<site>/: a top folder that holds a folder
 * named like an id is the old per-user layout.
 */
export async function siteFolders(storage: ListableStorage, root = "website-images"): Promise<Folder[]> {
  const out: Folder[] = [];
  for (const top of await listAll(storage, root)) {
    if (!isFolder(top) || !UUID.test(top.name)) continue;
    const below = await listAll(storage, `${root}/${top.name}`);
    const nested = below.filter((e) => isFolder(e) && UUID.test(e.name));
    if (nested.length) for (const s of nested) out.push({ id: s.name.toLowerCase(), folder: `${root}/${top.name}/${s.name}` });
    else out.push({ id: top.name.toLowerCase(), folder: `${root}/${top.name}` });
  }
  return out;
}

/** The top-level folders of a bucket that are named like an id (user-uploads/<user>/…). */
export async function topFolders(storage: ListableStorage): Promise<Folder[]> {
  return (await listAll(storage, "")).filter((e) => isFolder(e) && UUID.test(e.name)).map((e) => ({ id: e.name.toLowerCase(), folder: e.name }));
}

export type Verdict = "keep_exists" | "keep_in_use" | "keep_too_new" | "keep_empty" | "remove";
export type PlanItem = { id: string; folder: string; verdict: Verdict; files: string[] };

export type PlanChecks = {
  /** Of these ids, the ones that still exist (a site row, an account). */
  exist: (ids: string[]) => Promise<Set<string>>;
  /** True when something that stays still points at this folder. Optional (user files are never pointed at). */
  inUse?: (id: string) => Promise<boolean>;
  /** Files younger than this are never removed. */
  graceMs: number;
  now?: number;
};

export async function planRemovals(storage: ListableStorage, folders: Folder[], checks: PlanChecks): Promise<PlanItem[]> {
  const now = checks.now ?? Date.now();
  const alive = new Set<string>();
  const ids = [...new Set(folders.map((f) => f.id))];
  for (let i = 0; i < ids.length; i += 100) for (const id of await checks.exist(ids.slice(i, i + 100))) alive.add(id.toLowerCase());
  const plan: PlanItem[] = [];
  for (const f of folders) {
    if (alive.has(f.id)) { plan.push({ ...f, verdict: "keep_exists", files: [] }); continue; }
    if (checks.inUse && (await checks.inUse(f.id))) { plan.push({ ...f, verdict: "keep_in_use", files: [] }); continue; }
    const files = await listFiles(storage, f.folder);
    if (!files.length) { plan.push({ ...f, verdict: "keep_empty", files: [] }); continue; }
    if (files.some((x) => now - x.at < checks.graceMs)) { plan.push({ ...f, verdict: "keep_too_new", files: [] }); continue; }
    plan.push({ ...f, verdict: "remove", files: files.map((x) => x.path) });
  }
  return plan;
}
