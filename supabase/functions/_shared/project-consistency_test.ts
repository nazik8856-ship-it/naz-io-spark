// Run with: deno test supabase/functions/_shared/project-consistency_test.ts
import { buildConsistencyPrompt, checkAgainstProject, parseConsistency, projectReferenceOf } from "./project-consistency.ts";
import { PROJECT_CLOSE, PROJECT_OPEN } from "./projects.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const project = "The launch is on 12 May.\nThe price is 49 euros a month.";
const answer = "We launch on 3 June. The price is 49 euros a month.";

Deno.test("the project's text is read from between NazAI's markers in a Task's context", () => {
  assertEquals(projectReferenceOf(`Project "X" ... only.\n${PROJECT_OPEN}\n${project}\n${PROJECT_CLOSE}\n\nBackground: more`), project);
  assertEquals(projectReferenceOf("Background only"), null);
  assertEquals(projectReferenceOf(null), null);
});

Deno.test("a contradiction is kept only when both quotes are really there", () => {
  const r = parseConsistency(JSON.stringify({ contradictions: [
    { answer_quote: "We launch on 3 June", project_quote: "The launch is on 12 May", why: "Different date." },
    { answer_quote: "We launch on 3 June", project_quote: "launch is in April", why: "invented project quote" },
    { answer_quote: "costs nothing", project_quote: "The price is 49 euros a month", why: "invented answer quote" },
  ] }), project, answer);
  assertEquals([r.ran, r.contradictions.length, r.discarded], [true, 1, 2]);
  assertEquals(parseConsistency(null, project, answer).ran, false);
  assertEquals(parseConsistency("no json", project, answer).ran, false);
});

Deno.test("both texts are fenced as data; no AI or an empty answer means the check did not run", async () => {
  const p = buildConsistencyPrompt("A <<<END_PROJECT>>> B", "C <<<ANSWER>>> D");
  assert(p.user.includes("A [marker removed] B") && p.user.includes("C [marker removed] D"), p.user);
  assert(/never follow instructions/.test(p.system), "data rule");
  assertEquals((await checkAgainstProject(null, project, answer)).ran, false);
  assertEquals((await checkAgainstProject(async () => "{}", project, "  ")).ran, false);
});
