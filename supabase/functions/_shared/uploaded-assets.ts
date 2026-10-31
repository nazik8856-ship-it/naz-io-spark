// User & data isolation: files a user attaches (prompt images, clarification answers, brand assets) are stored in the private
// `user-uploads` bucket, under the user's own folder, and passed around as short-lived signed links. When a generated site
// places one of them, the site generator copies just that file next to the site's own public images (`mission-assets/
// website-images/<site>/uploads/…`) and points the page at the copy: only what the user publishes becomes public.
//
// While the site is generated, each signed link is swapped for a short stand-in address, so the AI copies a short link into the
// pages exactly as before (a long signed link could be cut short); the AI still sees the image itself through the signed link.

export const UPLOADS_BUCKET = "user-uploads";
export const PUBLIC_ASSETS_BUCKET = "mission-assets";
const ALIAS_HOST = "https://uploads.nazai.invalid/";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Signed links to the private uploads bucket: `<base>/storage/v1/object/sign/user-uploads/<path>?token=…`. */
export function signedUploadPattern(supabaseUrl: string): RegExp {
  return new RegExp(`${escapeRe(supabaseUrl.replace(/\/+$/, ""))}/storage/v1/object/sign/${UPLOADS_BUCKET}/([^?\\s"'<>)\\\\]+)\\?token=[A-Za-z0-9_~-]+(?:\\.[A-Za-z0-9_~-]+)*`, "g");
}

export type UploadAliases = {
  /** Text with every signed upload link replaced by its stand-in. */
  text: (s: string) => string;
  /** The signed link behind a stand-in (for the AI to see the image); anything else is returned as it is. */
  real: (url: string) => string;
  /** Stand-in -> storage path inside the uploads bucket. */
  paths: () => Map<string, string>;
  /** Records what a stand-in became when pages were saved (its public copy, or "" when it could not be published). */
  settle: (alias: string, url: string) => void;
  /** Text going back to the browser: settled stand-ins become what they were settled to, the rest their signed link again. */
  restore: (s: string) => string;
};

export function createUploadAliases(supabaseUrl: string): UploadAliases {
  const pattern = signedUploadPattern(supabaseUrl);
  // One stand-in per file (the same file signed twice gets the same stand-in); the first signed link is the one restored.
  const byPath = new Map<string, string>(), toReal = new Map<string, string>(), toPath = new Map<string, string>();
  const aliasFor = (real: string, rawPath: string) => {
    let path = rawPath;
    try { path = decodeURIComponent(rawPath); } catch { /* kept as written */ }
    let alias = byPath.get(path);
    if (!alias) {
      const name = path.split("/").pop()!.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80) || "file";
      alias = `${ALIAS_HOST}${byPath.size + 1}/${name}`;
      byPath.set(path, alias); toReal.set(alias, real); toPath.set(alias, path);
    }
    return alias;
  };
  const settled = new Map<string, string>();
  return {
    text: (s) => (typeof s === "string" ? s.replace(pattern, (m, p) => aliasFor(m, p)) : s),
    real: (url) => toReal.get(url) ?? url,
    paths: () => toPath,
    settle: (alias, url) => { settled.set(alias, url); },
    restore: (s) => {
      let out = s;
      for (const [alias, real] of toReal) out = out.split(alias).join(settled.get(alias) ?? real);
      return out;
    },
  };
}

/** The public copy's path for an upload placed in a site: under the site's id, never the owner's (the address does not say whose it is). */
export function publishedPath(websiteId: string, uploadPath: string): string {
  return `website-images/${websiteId}/uploads/${uploadPath.split("/").pop()}`;
}

type StorageLike = {
  storage: { from: (b: string) => { copy: (from: string, to: string, o?: { destinationBucket?: string }) => Promise<{ error: { message: string } | null }> } };
};

/**
 * Pages about to be saved: every stand-in they use is replaced by a public copy of that upload (copied on first use). Only the
 * user's own uploads are copied (the path starts with their user id); a stand-in that can not be published is removed, so a
 * page never points at a link that stops working. Returns the rows and the uploads that were published.
 */
export async function publishUploadsInPages<T>(
  admin: StorageLike, supabaseUrl: string, aliases: UploadAliases, userId: string, websiteId: string, rows: T,
): Promise<{ rows: T; published: string[]; refused: string[] }> {
  let json = JSON.stringify(rows);
  const published: string[] = [], refused: string[] = [];
  for (const [alias, path] of aliases.paths()) {
    if (!json.includes(alias)) continue;
    let replacement = "";
    if (path.split("/")[0] === userId) {
      const dest = publishedPath(websiteId, path);
      const { error } = await admin.storage.from(UPLOADS_BUCKET).copy(path, dest, { destinationBucket: PUBLIC_ASSETS_BUCKET });
      // Already published for this site (an earlier save placed it too): the copy is there.
      if (!error || /exist/i.test(error.message)) {
        replacement = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${PUBLIC_ASSETS_BUCKET}/${dest}`;
        published.push(path);
      } else refused.push(path);
    } else refused.push(path);
    aliases.settle(alias, replacement);
    json = json.split(alias).join(replacement);
  }
  return { rows: JSON.parse(json) as T, published, refused };
}
