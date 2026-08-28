#!/usr/bin/env node
// Local CLI for the 30-scenario control-system test suite.
//
//   node scripts/run-control-tests.mjs --token "<user access token>"
//   node scripts/run-control-tests.mjs --token "$TOKEN" --category block
//   node scripts/run-control-tests.mjs --token "$TOKEN" --ids A01,B03 --json
//
// Exits 1 if any scenario fails or errors, so it slots into CI as-is.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ekuodpaaiugzywfcmjeo.supabase.co";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhZWR1aW5maXJ0bGpuYmVjeXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MjMwMTcsImV4cCI6MjA4NzE5OTAxN30.d9LUMaj0_2C0802M2oRHYny6coTPQuHJ3DmF-crthU4";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const token = flag("token") || process.env.CONTROL_TEST_TOKEN;
if (!token) {
  console.error("Missing --token (or CONTROL_TEST_TOKEN). Use a signed-in user's access token.");
  process.exit(2);
}

const body = {
  dry_run: !has("live"),
  concurrency: Number(flag("concurrency")) || 4,
};
if (flag("ids")) body.ids = flag("ids").split(",").map((s) => s.trim()).filter(Boolean);
if (flag("category")) body.categories = flag("category").split(",").map((s) => s.trim()).filter(Boolean);

const resp = await fetch(`${SUPABASE_URL}/functions/v1/control-test-suite`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    apikey: ANON_KEY,
  },
  body: JSON.stringify(body),
});

const text = await resp.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error(`Runner returned ${resp.status}:\n${text}`);
  process.exit(1);
}

if (!resp.ok) {
  console.error(`Runner returned ${resp.status}: ${data.error ?? text}`);
  process.exit(1);
}

if (has("json")) {
  console.log(JSON.stringify(data, null, 2));
} else {
  console.log(data.report_markdown);
  const s = data.summary;
  console.log(
    `\n${s.pass} passed · ${s.soft_pass} soft · ${s.fail} failed · ${s.error} errored ` +
      `(${data.pass_rate_pct}% accepted, ${data.duration_ms}ms, dry_run=${data.dry_run})`,
  );
}

process.exit(data.ok ? 0 : 1);
