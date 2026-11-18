// CI dependency audit for the packages that ship to people (the website bundle and the MCP function): any high or critical advisory
// fails the build, except one listed in .github/audit-exemptions.json with a reason and an expiry date. An exemption covers one
// advisory id only, never a package, and stops counting on its expiry date, so a forgotten one fails the build again.
//   node scripts/audit-check.mjs            runs `npm audit --omit=dev --json` and checks it
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LEVELS = new Set(["high", "critical"]);
const idOf = (url) => (String(url ?? "").match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0] ?? String(url ?? "")).toLowerCase();

/** The advisories that fail the check: high or critical, not covered by an exemption still in date. Pure. */
export function blockingAdvisories(report, exemptions, today) {
  const live = new Map(exemptions.filter((e) => e.expires >= today).map((e) => [e.id.toLowerCase(), e]));
  const found = new Map();
  for (const [pkg, v] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via !== "object" || !LEVELS.has(via.severity)) continue; // a string names another package: its own advisory is listed there
      const id = idOf(via.url);
      if (!live.has(id)) found.set(id, { id, package: pkg, severity: via.severity, title: via.title });
    }
  }
  return [...found.values()];
}

function main() {
  let raw;
  try { raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { raw = e.stdout; } // npm audit exits non-zero when it finds anything; the JSON is still on stdout
  const report = JSON.parse(raw);
  const exemptions = JSON.parse(readFileSync(new URL("../.github/audit-exemptions.json", import.meta.url), "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  for (const e of exemptions) {
    console.log(`${e.expires >= today ? "exempt until" : "EXPIRED on"} ${e.expires}: ${e.id} (${e.package}) - ${e.reason}`);
  }
  const blocking = blockingAdvisories(report, exemptions, today);
  if (blocking.length) {
    for (const b of blocking) console.error(`${b.severity}: ${b.id} in ${b.package} - ${b.title}`);
    console.error(`${blocking.length} high or critical advisor${blocking.length === 1 ? "y" : "ies"} in shipped packages.`);
    process.exit(1);
  }
  console.log("No high or critical advisories in shipped packages (apart from the in-date exemptions above).");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
