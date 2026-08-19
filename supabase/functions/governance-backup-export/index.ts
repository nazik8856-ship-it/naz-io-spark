// Scheduled (pg_cron, daily, before retention-sweep): logical export of the
// core governance tables to Storage, independent of the platform's ~7-day
// managed-Postgres backup window. This is a safety net, not a substitute
// for a real restore drill -- it exists so "if the platform backup silently
// failed for a week" isn't a total-loss scenario. Service-role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BACKUP_TABLES, backupObjectPath, isExpiredBackupFolder, todayUtcDateString } from "../_shared/governance-backup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "governance-backups";
const RETENTION_DAYS = 30;
const PAGE_SIZE = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
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
      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(backupObjectPath(dateStr, table), new Blob([JSON.stringify(rows)], { type: "application/json" }), {
          upsert: true,
          contentType: "application/json",
        });
      if (uploadError) throw uploadError;
      exported[table] = rows.length;
    } catch (e) {
      errors[table] = e instanceof Error ? e.message : "unknown error";
    }
  }

  // Prune dated folders past the retention window.
  const deletedFolders: string[] = [];
  try {
    const { data: entries, error } = await admin.storage.from(BUCKET).list("");
    if (error) throw error;
    for (const entry of entries ?? []) {
      if (!isExpiredBackupFolder(entry.name, now, RETENTION_DAYS)) continue;
      const { data: files } = await admin.storage.from(BUCKET).list(entry.name);
      const paths = (files ?? []).map((f) => `${entry.name}/${f.name}`);
      if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
      deletedFolders.push(entry.name);
    }
  } catch (e) {
    errors["_prune"] = e instanceof Error ? e.message : "unknown error";
  }

  return json({
    ok: Object.keys(errors).length === 0,
    date: dateStr,
    exported,
    deletedFolders,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
});
