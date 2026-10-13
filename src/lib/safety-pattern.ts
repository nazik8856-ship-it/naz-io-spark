// Client-side check of a custom safety-rule pattern before it is saved. A pattern
// that merely parses can still hurt: one that matches the empty string would
// match everything (or splice a placeholder between every character), and a
// nested quantifier like (a+)+$ can hang the server's regex scan on a long reply.
// Mirrors the guards in supabase/functions/_shared/outer-control-scoring.ts.
const NESTED_QUANTIFIER = /\((?:[^()]*[+*][^()]*)\)[+*]/;

export function findPatternProblem(pattern: string): string | null {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return "That pattern isn't a valid expression. Check it and try again.";
  }
  if (re.test("")) {
    return "That pattern matches empty text, so it would match every response. Make it require at least one character (for example use + instead of *).";
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    return "That pattern repeats a repeated group, like (a+)+, which can make checks very slow on long replies. Simplify it.";
  }
  return null;
}
