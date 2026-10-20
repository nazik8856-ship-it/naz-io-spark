// Inner Control always shows one project: an agent or a website the account has made. This is the pure part: what counts as a
// project, which one is shown when the page opens (the one the person has spent the most time on), and which rules belong to it.

export type ProjectKind = "agent" | "website";

export type InnerProject = {
  key: string;
  kind: ProjectKind;
  id: string;
  name: string;
  createdAt: string;
  /** Websites only: what the generation checks found, and the trust score stored with the site. */
  website?: { notes: string[]; trustScore: number | null };
};

export const projectKey = (kind: ProjectKind, id: string) => `${kind}:${id}`;
export const KIND_LABEL: Record<ProjectKind, string> = { agent: "Agent", website: "Website" };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

type AgentRow = { id: string; name: string | null; created_at: string };
type WebsiteRow = { id: string; name?: string | null; title?: string | null; created_at: string; generation_notes?: unknown; trust_score?: number | null };

/** Every agent and website of the account, newest first. A project always has a readable name. */
export function toProjects(agents: AgentRow[], websites: WebsiteRow[]): InnerProject[] {
  const a: InnerProject[] = agents.map((r) => ({
    key: projectKey("agent", r.id), kind: "agent", id: r.id, createdAt: r.created_at, name: clip(squash(r.name ?? "") || "Untitled agent", 60),
  }));
  const w: InnerProject[] = websites.map((r) => ({
    key: projectKey("website", r.id), kind: "website", id: r.id, createdAt: r.created_at,
    name: clip(squash(r.name ?? "") || squash(r.title ?? "") || "Untitled website", 60),
    website: {
      notes: Array.isArray(r.generation_notes) ? (r.generation_notes as unknown[]).filter((n): n is string => typeof n === "string") : [],
      trustScore: typeof r.trust_score === "number" ? r.trust_score : null,
    },
  }));
  return [...a, ...w].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
}

/**
 * The project to show: the one chosen on this page if it still exists, otherwise the one with the most time spent on it, otherwise
 * the newest. Null only when the account has no project at all.
 */
export function pickProject(i: { projects: InnerProject[]; seconds: Record<string, number>; chosen: string | null }): InnerProject | null {
  if (i.projects.length === 0) return null;
  const chosen = i.chosen ? i.projects.find((p) => p.key === i.chosen) : undefined;
  if (chosen) return chosen;
  return [...i.projects].sort((a, b) =>
    (i.seconds[b.key] ?? 0) - (i.seconds[a.key] ?? 0) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )[0];
}

type Scoped = { agent_id?: string | null; api_key_id?: string | null };

/**
 * The rules that apply to a project. An agent: the rules written for it plus the ones for all agents. A website: the rules for all
 * agents (the account's own rules, the ones its pages are checked against when generated). Rules of an API key belong to Outer Control.
 */
export function rulesFor<T extends Scoped>(project: InnerProject | null | undefined, rows: T[]): T[] {
  if (!project) return rows;
  return rows.filter((r) => !r.api_key_id && (!r.agent_id || (project.kind === "agent" && r.agent_id === project.id)));
}

// ---- remembering the choice for this visit only -------------------------------------------------------------------------

const PREFIX = "nazai_inner_project:";
export const choiceStorageKey = (accountId: string) => `${PREFIX}${accountId}`;

export function readChoice(accountId: string): string | null {
  try { return sessionStorage.getItem(choiceStorageKey(accountId)); } catch { return null; }
}
export function writeChoice(accountId: string, key: string) {
  try { sessionStorage.setItem(choiceStorageKey(accountId), key); } catch { /* the choice just is not remembered */ }
}
/** Opening Inner Control from the welcome screen starts from the most-used project again. */
export function forgetChoices() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
  } catch { /* nothing to forget */ }
}

/** How often, in seconds, an open project page reports the time spent on it. */
export const PROJECT_TIME_TICK_SECONDS = 15;
