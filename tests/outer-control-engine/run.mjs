// Runs the Outer Control session engine tests: the real engine code (supabase/functions/_shared) against an in-memory fake of the
// database and a scripted fake of the outside tool. Run with `npm run test:engine`.
//
// The engine is written for Deno (https imports, Deno.env), so it is bundled with esbuild: the Supabase client import is replaced
// by the fake in fake-supabase.ts, Sentry by a no-op, and a small preamble stands in for the Deno globals. The test file is
// compiled next to the bundle and run with plain node.
import { build, transform } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, ".out");
await mkdir(out, { recursive: true });

await build({
  entryPoints: [path.join(here, "entry-session.ts")], outfile: path.join(out, "out-session.mjs"),
  bundle: true, format: "esm", platform: "node", logLevel: "error", legalComments: "none",
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^npm:@sentry/ }, () => ({ path: path.join(here, "sentry-stub.ts") }));
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: path.join(here, "fake-supabase.ts") }));
  } }],
});
// Each test file is compiled next to the bundle and run with plain node.
let failed = false;
for (const name of ["session-test", "goal-test"]) {
  const test = await transform(await readFile(path.join(here, `${name}.mts`), "utf8"), { loader: "ts", format: "esm", target: "node20" });
  await writeFile(path.join(out, `${name}.mjs`), test.code);
  const run = spawnSync(process.execPath, [path.join(out, `${name}.mjs`)], { stdio: "inherit" });
  if (run.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
