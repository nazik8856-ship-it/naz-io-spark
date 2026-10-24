// Imported projects: the real projects module against the in-memory database, a scripted web and a scripted Notion.
import assert from "node:assert/strict";
const H = await import("./out-session.mjs");

const U = "acct-1", PERSON = "person-1";
let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void>) { try { await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + ": " + (e as Error).message); } }

type Page = { status?: number; contentType?: string; text?: string };
let web: Record<string, Page> = {};
let notionPages: Record<string, { title: string; blocks: any[] }> = {};
let notionConnected = true;
const notionCalls: string[] = [];
const deps = {
  now: () => Date.parse("2026-10-24T10:00:00Z"),
  checkUrl: async (u: string) => (/^https:\/\//.test(u) && !/localhost|127\.0\.0\.1|10\.\d/.test(u) ? { ok: true, reason: "" } : { ok: false, reason: "blocked address" }),
  fetchUrl: async (u: string) => {
    const p = web[u];
    if (!p) return { ok: false, status: 404, contentType: "text/html", text: "", finalUrl: u, error: "The page answered HTTP 404." };
    const status = p.status ?? 200;
    return { ok: status < 400, status, contentType: p.contentType ?? "text/html", text: p.text ?? "", finalUrl: u };
  },
  notion: async (_a: any, _acct: string, path: string, init?: any) => {
    notionCalls.push(`${init?.method ?? "GET"} ${path}`);
    if (!notionConnected) return { ok: false, status: 0, json: null, connected: false };
    if (path === "/v1/search") return { ok: true, status: 200, connected: true, json: { results: Object.entries(notionPages).map(([id, p]) => ({ id, url: `https://notion.so/${id}`, last_edited_time: "2026-10-20T00:00:00Z", properties: { title: { type: "title", title: [{ plain_text: p.title }] } } })) } };
    const m = path.match(/^\/v1\/(pages|blocks)\/([0-9a-f]{32})/);
    const page = m ? notionPages[m[2]] : null;
    if (!page) return { ok: false, status: 404, connected: true, json: { message: "Could not find page with ID" } };
    if (m![1] === "pages") return { ok: true, status: 200, connected: true, json: { id: m![2], properties: { title: { type: "title", title: [{ plain_text: page.title }] } } } };
    return { ok: true, status: 200, connected: true, json: { results: page.blocks, has_more: false } };
  },
};
const act = (body: any) => H.handleProjectsAction(H.createClient("u", "k"), U, PERSON, body, deps);
const projects = () => H.table("imported_projects");
const PAGE = "0123456789abcdef0123456789abcdef";
const para = (text: string, type = "paragraph") => ({ type, [type]: { rich_text: [{ plain_text: text }] } });
function setup() {
  H.reset(); web = {}; notionPages = {}; notionConnected = true; notionCalls.length = 0;
  H.state.rpc.read_integration_secret = { access_token: "secret-token" };
}

await t("snapshot by paste: stored as a snapshot copy, named from its first line, checked against the account's rules", async () => {
  setup();
  H.table("safety_rules").push({ id: "sr1", user_id: U, name: "No codename", category: "custom", pattern: "zzcodename", severity: "block", redact: true, enabled: true, shadow_mode: false, agent_id: null, api_key_id: null });
  const r = await act({ action: "import_paste", text: "# Launch plan\n\nThe zzcodename ships in May.\n\n- Step one" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = projects()[0];
  assert.equal(p.user_id, U); assert.equal(p.name, "Launch plan"); assert.equal(p.source_mode, "snapshot"); assert.equal(p.source_kind, "paste");
  assert.equal(p.content_type, "markdown"); assert.equal(p.write_back, false); assert.match(p.content_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.body.check.matches, [{ name: "No codename", action: "remove_text" }]);
  assert.ok(r.body.check.rules >= 1, "the account's rules (built-in ones included) were counted");
  assert.match(p.content, /zzcodename/, "the project keeps its own text; what tools receive is cleaned later");
});

await t("snapshot by upload: text files only, at most 20, joined under their names; the type follows the files", async () => {
  setup();
  let r = await act({ action: "import_files", files: [{ name: "app.ts", text: "export const a = 1;" }, { name: "README.md", text: "# App" }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = projects()[0];
  assert.equal(p.name, "2 files"); assert.equal(p.source_kind, "file"); assert.equal(p.content_type, "mixed");
  assert.match(p.content, /=== app\.ts ===\nexport const a = 1;\n\n=== README\.md ===\n# App/);
  assert.deepEqual(p.files, [{ name: "app.ts", chars: 19 }, { name: "README.md", chars: 5 }]);
  r = await act({ action: "import_files", files: [{ name: "photo.png", text: "x" }] });
  assert.equal(r.status, 400); assert.match(r.body.message, /photo\.png is not a text file/);
  r = await act({ action: "import_files", files: Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.txt`, text: "x" })) });
  assert.equal(r.status, 400); assert.match(r.body.message, /At most 20 files/);
  assert.equal(projects().length, 1, "a refused import stores nothing");
});

await t("snapshot by link: the page as readable text, never rendered; a private address or a non-text page is refused", async () => {
  setup();
  web["https://example.com/about"] = { text: "<html><head><title>About Acme</title><script>alert(1)</script></head><body><h1>Acme</h1><p>We make <b>rockets</b> &amp; more.</p><ul><li>Fast</li><li>Safe</li></ul></body></html>" };
  let r = await act({ action: "import_link", url: "https://example.com/about" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = projects()[0];
  assert.equal(p.name, "About Acme"); assert.equal(p.source_label, "example.com"); assert.equal(p.source_ref, "https://example.com/about");
  assert.equal(p.content, "# Acme\n\nWe make rockets & more.\n\n- Fast\n- Safe"); assert.ok(!p.content.includes("alert"));
  r = await act({ action: "import_link", url: "https://10.0.0.5/admin" });
  assert.equal(r.status, 400); assert.match(r.body.message, /can't be imported: blocked address/);
  web["https://example.com/a.pdf"] = { contentType: "application/pdf", text: "%PDF" };
  r = await act({ action: "import_link", url: "https://example.com/a.pdf" });
  assert.equal(r.status, 415); assert.match(r.body.message, /not a text page/);
  r = await act({ action: "import_link", url: "https://example.com/missing" });
  assert.equal(r.status, 502); assert.match(r.body.message, /HTTP 404/);
  assert.equal(projects().length, 1);
});

await t("snapshot by link: a public GitHub repository brings its README and its top-level files", async () => {
  setup();
  web["https://raw.githubusercontent.com/acme/rocket/HEAD/README.md"] = { contentType: "text/plain", text: "# Rocket\n\nA launcher." };
  web["https://api.github.com/repos/acme/rocket/contents"] = { contentType: "application/json", text: JSON.stringify([{ name: "src", type: "dir" }, { name: "package.json", type: "file" }]) };
  const r = await act({ action: "import_link", url: "https://github.com/acme/rocket" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = projects()[0];
  assert.equal(p.name, "acme/rocket"); assert.equal(p.content_type, "markdown"); assert.equal(p.source_label, "github.com");
  assert.match(p.content, /^# Rocket\n\nA launcher\.\n\n## Files\n\n📁 src\n- package\.json$/);
  assert.equal((await act({ action: "import_link", url: "https://github.com/acme/private" })).status, 404);
});

await t("too large: more than 200,000 characters is refused with the size", async () => {
  setup();
  const r = await act({ action: "import_paste", text: "x".repeat(H.MAX_PROJECT_CHARS + 1) });
  assert.equal(r.status, 413); assert.match(r.body.message, /at most 200,000 characters; this one has 200,001/);
  assert.equal(projects().length, 0);
});

await t("connected import: Notion pages are listed; a chosen page is imported linked to its original, as markdown", async () => {
  setup();
  notionPages[PAGE] = { title: "Brand guide", blocks: [para("Voice", "heading_2"), para("Short sentences."), para("No jargon", "bulleted_list_item"), { type: "to_do", to_do: { rich_text: [{ plain_text: "Review" }], checked: true } }] };
  const s = await act({ action: "notion_search", query: "brand" });
  assert.deepEqual(s.body.pages.map((p: any) => [p.id, p.title]), [[PAGE, "Brand guide"]]);
  const r = await act({ action: "import_notion", page_id: PAGE });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = projects()[0];
  assert.equal(p.name, "Brand guide"); assert.equal(p.source_mode, "linked"); assert.equal(p.source_kind, "notion"); assert.equal(p.source_ref, PAGE);
  assert.equal(p.content, "## Voice\n\nShort sentences.\n\n- No jargon\n\n- [x] Review"); assert.equal(p.last_synced_at, "2026-10-24T10:00:00.000Z");
  assert.ok(notionCalls.every((c) => c.startsWith("GET") || c === "POST /v1/search"), "importing only reads from Notion");
});

await t("connected import: without Notion, or for a page not shared with NazAI, nothing is stored and the reason is said", async () => {
  setup(); notionConnected = false;
  let r = await act({ action: "import_notion", page_id: PAGE });
  assert.equal(r.status, 409); assert.match(r.body.message, /Notion is not connected/);
  notionConnected = true;
  r = await act({ action: "import_notion", page_id: PAGE });
  assert.equal(r.status, 502); assert.match(r.body.message, /Could not find page.*shared with NazAI/);
  assert.equal(projects().length, 0);
});

await t("refresh: only a linked project; it reads the page again and says whether it changed", async () => {
  setup();
  notionPages[PAGE] = { title: "Brand guide", blocks: [para("Short sentences.")] };
  await act({ action: "import_notion", page_id: PAGE });
  const id = projects()[0].id;
  let r = await act({ action: "refresh", project_id: id });
  assert.equal(r.body.changed, false);
  notionPages[PAGE].blocks.push(para("Use plain words."));
  r = await act({ action: "refresh", project_id: id });
  assert.equal(r.body.changed, true); assert.match(projects()[0].content, /Use plain words\./); assert.equal(projects()[0].sync_error, null);
  delete notionPages[PAGE];
  r = await act({ action: "refresh", project_id: id });
  assert.equal(r.status, 502); assert.match(projects()[0].sync_error, /Notion refused/);
  await act({ action: "import_paste", text: "A snapshot" });
  r = await act({ action: "refresh", project_id: projects()[1].id });
  assert.equal(r.status, 409); assert.match(r.body.message, /Only a linked project/);
});

await t("write-back: off by default; never for a snapshot; turning it on needs the name typed; a write only creates an approval", async () => {
  setup();
  notionPages[PAGE] = { title: "Brand guide", blocks: [para("Short sentences.")] };
  await act({ action: "import_notion", page_id: PAGE });
  const id = projects()[0].id;
  let r = await act({ action: "write_back", project_id: id, text: "New section" });
  assert.equal(r.status, 403); assert.match(r.body.message, /Write-back is off/);
  r = await act({ action: "set_write_back", project_id: id, enabled: true, confirm_name: "brand" });
  assert.equal(r.status, 400); assert.equal(projects()[0].write_back, false);
  r = await act({ action: "set_write_back", project_id: id, enabled: true, confirm_name: "Brand guide" });
  assert.equal(r.body.write_back, true); assert.equal(projects()[0].write_back_enabled_at, "2026-10-24T10:00:00.000Z");
  notionCalls.length = 0;
  r = await act({ action: "write_back", project_id: id, text: "## New section\n\nKeep it short." });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ap = H.table("pending_approvals")[0];
  assert.equal(ap.action_type, "notion_update_page"); assert.equal(ap.status, "pending"); assert.equal(ap.user_id, U); assert.equal(ap.requester_id, PERSON);
  assert.deepEqual(ap.params, { page_id: PAGE, append_markdown: "## New section\n\nKeep it short.", project_id: id });
  assert.equal(notionCalls.length, 0, "nothing was sent to Notion: the approval's Run it does that");
  await act({ action: "set_write_back", project_id: id, enabled: false });
  assert.equal((await act({ action: "write_back", project_id: id, text: "More" })).status, 403);
  await act({ action: "import_paste", text: "A snapshot" });
  const snap = projects()[1].id;
  assert.equal((await act({ action: "set_write_back", project_id: snap, enabled: true, confirm_name: "A snapshot" })).status, 409);
  assert.equal((await act({ action: "write_back", project_id: snap, text: "x" })).status, 409);
});

await t("write-back: the text leaving NazAI is checked; a blocked text creates no approval; a secret is cut out first", async () => {
  setup();
  H.table("safety_rules").push({ id: "sr-b", user_id: U, name: "No prices", category: "custom", pattern: "\\$\\d+", severity: "block", redact: false, enabled: true, shadow_mode: false, agent_id: null, api_key_id: null });
  notionPages[PAGE] = { title: "Guide", blocks: [para("Text.")] };
  await act({ action: "import_notion", page_id: PAGE });
  const id = projects()[0].id;
  await act({ action: "set_write_back", project_id: id, enabled: true, confirm_name: "Guide" });
  let r = await act({ action: "write_back", project_id: id, text: "It costs $40." });
  assert.equal(r.status, 422); assert.match(r.body.message, /A rule blocks this text: No prices/);
  assert.equal(H.table("pending_approvals").length, 0);
  r = await act({ action: "write_back", project_id: id, text: "Key sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD is here." });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!H.table("pending_approvals")[0].params.append_markdown.includes("sk-abcdefghij"), "the secret never reaches the approval or Notion");
});

await t("write-back: text that Notion would cut (too many or too long paragraphs) is refused, not sent cut", async () => {
  setup();
  notionPages[PAGE] = { title: "Guide", blocks: [para("Text.")] };
  await act({ action: "import_notion", page_id: PAGE });
  const id = projects()[0].id;
  await act({ action: "set_write_back", project_id: id, enabled: true, confirm_name: "Guide" });
  let r = await act({ action: "write_back", project_id: id, text: "x".repeat(1901) });
  assert.equal(r.status, 413); assert.match(r.body.message, /at most 90 paragraphs of up to 1,900 characters/);
  r = await act({ action: "write_back", project_id: id, text: Array.from({ length: 91 }, (_, i) => `Paragraph ${i}`).join("\n\n") });
  assert.equal(r.status, 413);
  assert.equal(H.table("pending_approvals").length, 0);
  r = await act({ action: "write_back", project_id: id, text: Array.from({ length: 90 }, (_, i) => `Paragraph ${i}`).join("\n\n") });
  assert.equal(r.status, 200);
});
await t("project rules: words become a rule for this project only; the check is updated; another project is not affected", async () => {
  setup();
  await act({ action: "import_paste", text: "Project Falcon launches in May." });
  await act({ action: "import_paste", text: "Falcon is also here." });
  const [a, b] = projects();
  const r = await act({ action: "add_rule", project_id: a.id, name: "Hide the codename", words: "Falcon, Project Hawk", rule_action: "remove" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.check.matches, [{ name: "Hide the codename", action: "remove_text" }]);
  const rules = await H.rulesForProject(H.createClient("u", "k"), U, a.id);
  assert.ok(rules.some((x: any) => x.name === "Hide the codename"));
  const other = await H.rulesForProject(H.createClient("u", "k"), U, b.id);
  assert.ok(!other.some((x: any) => x.name === "Hide the codename"), "a project's rule never applies to another project");
  const acct = await H.rulesForProject(H.createClient("u", "k"), U, null);
  assert.ok(!acct.some((x: any) => x.name === "Hide the codename"), "nor to the account");
  const ctx = await H.projectContextFor(H.createClient("u", "k"), U, a.id);
  assert.ok(ctx.ok && !ctx.text.includes("Falcon") && ctx.removed.includes("Hide the codename"), JSON.stringify(ctx));
  const ruleId = H.table("project_rules")[0].id;
  const rm = await act({ action: "remove_rule", project_id: a.id, rule_id: ruleId });
  assert.deepEqual(rm.body.check.matches, []);
  assert.equal((await act({ action: "add_rule", project_id: a.id, name: "x", words: "  ", rule_action: "remove" })).status, 400);
  for (let i = 0; i < 20; i++) await act({ action: "add_rule", project_id: a.id, name: `r${i}`, words: `w${i}`, rule_action: "block" });
  assert.equal((await act({ action: "add_rule", project_id: a.id, name: "one more", words: "z", rule_action: "block" })).status, 409);
});

await t("word rules match whole words, any case, across spaces; regex characters are taken literally", async () => {
  const re = new RegExp(H.wordsToPattern("Falcon, C++ team, a.b")!, "i");
  assert.ok(re.test("the FALCON launch")); assert.ok(!re.test("falconry")); assert.ok(re.test("our c++   team")); assert.ok(!re.test("axb"));
});

await t("Outer Control context: the project's checked text, clipped, with its kind; a rule that blocks it stops it; another account's project is not found", async () => {
  setup();
  await act({ action: "import_paste", text: "Plan\n" + "word ".repeat(2000) });
  const id = projects()[0].id;
  let ctx = await H.projectContextFor(H.createClient("u", "k"), U, id);
  assert.ok(ctx.ok); assert.match(ctx.text, /^Project "Plan" \(snapshot copy\), checked by NazAI:\nPlan\n/); assert.match(ctx.text, /\[… the first 6,000 of 10,005 characters\]$/);
  await act({ action: "add_rule", project_id: id, name: "No word", words: "word", rule_action: "block" });
  ctx = await H.projectContextFor(H.createClient("u", "k"), U, id);
  assert.ok(!ctx.ok); assert.match(ctx.message, /A rule blocks this project's text from going to tools: No word/);
  assert.equal((await H.projectContextFor(H.createClient("u", "k"), "acct-2", id)).ok, false);
});

await t("rename and archive; another account's project can not be touched", async () => {
  setup();
  await act({ action: "import_paste", text: "Notes" });
  const id = projects()[0].id;
  await act({ action: "rename", project_id: id, name: "  Q4   notes " });
  assert.equal(projects()[0].name, "Q4 notes");
  await act({ action: "archive", project_id: id });
  assert.equal(projects()[0].archived_at, "2026-10-24T10:00:00.000Z");
  const other = await H.handleProjectsAction(H.createClient("u", "k"), "acct-2", "p2", { action: "rename", project_id: id, name: "Mine" }, deps);
  assert.equal(other.status, 404); assert.equal(projects()[0].name, "Q4 notes");
});

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
