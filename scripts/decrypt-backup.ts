// Turns a downloaded governance backup file back into its JSON (data encryption, front 5).
//
//   1. Supabase → Storage → governance-backups: download the file, keeping its dated folder (e.g. 2026-10-30/hard_rules.json.enc).
//   2. DATA_KEY=<the key> deno run --allow-env --allow-read --allow-write scripts/decrypt-backup.ts 2026-10-30/hard_rules.json.enc [out.json]
//      (during a key rotation, also set DATA_KEY_PREVIOUS). Without an output file the JSON is written to stdout.
//
// The file is bound to its storage path, so it must stay in a folder named after its date. Plain .json files from before
// the encryption need no decrypting.
import { dataKeysFromEnv } from "../supabase/functions/_shared/field-crypto.ts";
import { backupStoragePath, openBackup } from "../supabase/functions/_shared/governance-backup.ts";

const [file, out] = Deno.args;
if (!file) {
  console.error("usage: DATA_KEY=… deno run --allow-env --allow-read --allow-write scripts/decrypt-backup.ts <date>/<table>.json.enc [out.json]");
  Deno.exit(2);
}
const keys = await dataKeysFromEnv();
if (!keys) {
  console.error("DATA_KEY is not set (or too short).");
  Deno.exit(2);
}
try {
  const json = await openBackup(keys, backupStoragePath(file), await Deno.readTextFile(file));
  const rows = JSON.parse(json);
  if (out) {
    await Deno.writeTextFile(out, json);
    console.error(`${file}: ${Array.isArray(rows) ? rows.length : "?"} rows written to ${out}`);
  } else {
    console.log(json);
  }
} catch (e) {
  console.error(`${file} could not be decrypted: ${e instanceof Error ? e.message : e}. Is it the right DATA_KEY, and is the file still in its dated folder?`);
  Deno.exit(1);
}
