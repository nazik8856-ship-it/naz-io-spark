// Secrets handling, front 4: a server secret that is missing, misnamed or too short stops the function at startup with the
// secret's name in the error, instead of the function quietly running without it (the PROJECT_KEY / PROJECTS_KEY typo). Called at
// module level, so the failure is a boot error in the function logs. Only names are ever printed, never a value.

export type Env = { get: (name: string) => string | undefined; names: () => string[] };
const denoEnv: Env = { get: (n) => Deno.env.get(n), names: () => { try { return Object.keys(Deno.env.toObject()); } catch { return []; } } };

/** Edit distance, for "did you mean" (names are short). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** Configured names that look like a typo of `name` (PROJECT_KEY for PROJECTS_KEY, projects_key, PROJECTS-KEY). */
export function similarNames(name: string, names: string[]): string[] {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return names.filter((n) => n !== name && distance(norm(n), norm(name)) <= 2).sort();
}

function check(name: string, value: string, minLength: number): string {
  if (value.length < minLength) throw new Error(`Server secret ${name} is too short: ${value.length} characters, at least ${minLength} needed.`);
  return value;
}

/** The secret's value; throws, naming it (and any similarly named secret), when it is not set or too short. */
export function requireSecret(name: string, opts: { minLength?: number; env?: Env } = {}): string {
  const env = opts.env ?? denoEnv;
  const value = (env.get(name) ?? "").trim();
  if (!value) {
    const near = similarNames(name, env.names());
    throw new Error(`Server secret ${name} is not set.${near.length ? ` Found ${near.join(", ")}: did you mean ${name}?` : ""} Add it in Supabase → Edge Functions → Secrets.`);
  }
  return check(name, value, opts.minLength ?? 1);
}

/** For a secret that may be absent (a rotation's _PREVIOUS): undefined when not set, but set and too short still throws. */
export function optionalSecret(name: string, opts: { minLength?: number; env?: Env } = {}): string | undefined {
  const value = ((opts.env ?? denoEnv).get(name) ?? "").trim();
  return value ? check(name, value, opts.minLength ?? 1) : undefined;
}
