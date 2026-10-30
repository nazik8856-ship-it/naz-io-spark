// Scheduled (pg_cron, daily, before retention-sweep): logical export of the
// core governance tables to Storage, independent of the platform's ~7-day
// managed-Postgres backup window. This is a safety net, not a substitute
// for a real restore drill -- it exists so "if the platform backup silently
// failed for a week" isn't a total-loss scenario. Service-role only.
//
// Data encryption, front 5: every file is encrypted with DATA_KEY before it is uploaded ("<date>/<table>.json.enc",
// _shared/governance-backup.ts). Each run also converts what is left from before: a plain "<table>.json" is encrypted, checked
// by downloading and decrypting the new file, and only then deleted; during a key rotation, files on the previous key are
// re-encrypted with the current one. POST { "action": "verify", "date": "YYYY-MM-DD" } is the restore drill: it decrypts that
// day's files and returns how many rows each holds (never their content).
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
// The plain client on purpose: the backup copies rows as stored, so encrypted content stays encrypted in the backup files
// (restorable with DATA_KEY), never written out decrypted (data encryption, front 4).
import { createPlainClient as createClient } from "../_shared/encrypted-client.ts";
import { envDataKeys } from "../_shared/encrypted-db.ts";
import {
  BACKUP_TABLES, backupFileAction, encryptedBackupPath, isExpiredBackupFolder, openBackup, sealBackup, todayUtcDateString,
} from "../_shared/governance-backup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "governance-backups";
const RETENTION_DAYS = 30;
const PAGE_SIZE = 1000;
const MAX_CONVERT_PER_RUN = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const keys = await envDataKeys();
  if (!keys) return json({ error: "DATA_KEY is not configured" }, 500);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const storage = admin.storage.from(BUCKET);
  const body = await req.json().catch(() => ({})) as { action?: string; date?: string };

  const download = async (path: string): Promise<string> => {
    const { data, error } = await storage.download(path);
    if (error || !data) throw new Error(`download ${path}: ${error?.message ?? "empty"}`);
    return await data.text();
  };
  const listFolder = async (folder: string) => {
    const { data, error } = await storage.list(folder, { limit: 1000 });
    if (error) throw error;
    return (data ?? []).filter((f) => f.id); // files only (folders have no id)
  };

  if (body.action === "verify") {
    const { data: folders, error } = await storage.list("", { limit: 1000 });
    if (error) return json({ ok: false, error: error.message }, 500);
    const dates = (folders ?? []).map((f) => f.name).filter((n) => DATE_RE.test(n)).sort();
    const date = body.date && DATE_RE.test(body.date) ? body.date : dates[dates.length - 1];
    if (!date) return json({ ok: false, error: "no backups yet" }, 404);
    const rows: Record<string, number> = {};
    const failures: Record<string, string> = {};
    for (const f of await listFolder(date)) {
      const path = `${date}/${f.name}`;
      if (!f.name.endsWith(".json.enc")) { failures[f.name] = "not encrypted"; continue; }
      try {
        const parsed = JSON.parse(await openBackup(keys, path, await download(path)));
        rows[f.name.replace(/\.json\.enc$/, "")] = Array.isArray(parsed) ? parsed.length : -1;
      } catch (e) {
        failures[f.name] = e instanceof Error ? e.message : "unknown error";
      }
    }
    const missing = BACKUP_TABLES.filter((t) => !(t in rows) && !(`${t}.json.enc` in failures));
    const ok = Object.keys(failures).length === 0 && missing.length === 0;
    return json({ ok, date, rows, failures: Object.keys(failures).length ? failures : undefined, missing: missing.length ? missing : undefined });
  }

  const now = new Date();
  const dateStr = todayUtcDateString(now);

  const exported: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const table of BACKUP_TABLES) {
    try {
      const rows: unknown[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await admin.from(table).select("*").range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      const path = encryptedBackupPath(dateStr, table);
      const sealed = await sealBackup(keys, path, JSON.stringify(rows));
      const { error: uploadError } = await storage.upload(path, new Blob([sealed], { type: "text/plain" }), {
        upsert: true,
        contentType: "text/plain",
      });
      if (uploadError) throw uploadError;
      exported[table] = rows.length;
    } catch (e) {
      errors[table] = e instanceof Error ? e.message : "unknown error";
    }
  }

  // Prune dated folders past the retention window; convert what is left in the others.
  const deletedFolders: string[] = [];
  const converted = { encrypted: 0, rekeyed: 0, left: 0 };
  try {
    const { data: entries, error } = await storage.list("", { limit: 1000 });
    if (error) throw error;
    let budget = MAX_CONVERT_PER_RUN;
    for (const entry of entries ?? []) {
      if (isExpiredBackupFolder(entry.name, now, RETENTION_DAYS)) {
        const files = await listFolder(entry.name);
        const paths = files.map((f) => `${entry.name}/${f.name}`);
        if (paths.length > 0) await storage.remove(paths);
        deletedFolders.push(entry.name);
        continue;
      }
      if (!DATE_RE.test(entry.name)) continue;
      const files = await listFolder(entry.name);
      const names = new Set(files.map((f) => f.name));
      for (const f of files) {
        const path = `${entry.name}/${f.name}`;
        // Today's export already wrote the encrypted file: the plain one from an earlier run is older, so it is only removed.
        if (f.name.endsWith(".json") && names.has(`${f.name}.enc`) && entry.name === dateStr && !(f.name.replace(/\.json$/, "") in errors)) {
          const { error: rmErr } = await storage.remove([path]);
          if (rmErr) errors[`_convert:${path}`] = rmErr.message; else converted.encrypted++;
          continue;
        }
        // Files on the current key are only read during a rotation (no previous key, nothing to re-encrypt).
        const head = f.name.endsWith(".enc") && keys.previous ? (await download(path)).slice(0, 64) : null;
        const action = backupFileAction(keys, f.name, head);
        if (!action) continue;
        if (budget <= 0) { converted.left++; continue; }
        budget--;
        try {
          const target = action === "encrypt" ? `${path}.enc` : path;
          const content = action === "encrypt" ? await download(path) : await openBackup(keys, path, await download(path));
          const sealed = await sealBackup(keys, target, content);
          const { error: upErr } = await storage.upload(target, new Blob([sealed], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
          if (upErr) throw upErr;
          // Checked as stored before anything is deleted: the new file must decrypt to exactly what the old one held.
          if (await openBackup(keys, target, await download(target)) !== content) throw new Error("check after upload failed");
          if (action === "encrypt") {
            const { error: rmErr } = await storage.remove([path]);
            if (rmErr) throw rmErr;
            converted.encrypted++;
          } else {
            converted.rekeyed++;
          }
        } catch (e) {
          converted.left++;
          errors[`_convert:${path}`] = e instanceof Error ? e.message : "unknown error";
        }
      }
    }
  } catch (e) {
    errors["_prune"] = e instanceof Error ? e.message : "unknown error";
  }

  return json({
    ok: Object.keys(errors).length === 0,
    date: dateStr,
    exported,
    deletedFolders,
    converted,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
});
