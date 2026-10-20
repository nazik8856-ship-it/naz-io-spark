import { describe, it, expect, beforeEach } from "vitest";
import { choiceStorageKey, forgetChoices, pickProject, projectKey, readChoice, rulesFor, toProjects, writeChoice } from "@/lib/inner-projects";

const agents = [
  { id: "a1", name: "Put an expensive drink on the table of the host with a very long name that keeps going and going on", created_at: "2026-10-10T00:00:00Z" },
  { id: "a2", name: "  Support   agent ", created_at: "2026-10-12T00:00:00Z" },
];
const websites = [
  { id: "w1", name: null, title: "Lisbon Yoga Studio", created_at: "2026-10-11T00:00:00Z", generation_notes: ["a note", 7], trust_score: 92 },
  { id: "w2", name: "", title: "", created_at: "2026-10-09T00:00:00Z", generation_notes: null, trust_score: null },
];

describe("what counts as a project", () => {
  it("is every agent and website, newest first, each with a readable name", () => {
    const p = toProjects(agents, websites);
    expect(p.map((x) => x.key)).toEqual(["agent:a2", "website:w1", "agent:a1", "website:w2"]);
    expect(p[0].name).toBe("Support agent");
    expect(p[1].name).toBe("Lisbon Yoga Studio");
    expect(p[2].name.length).toBeLessThanOrEqual(60);
    expect(p[2].name.endsWith("…")).toBe(true);
    expect(p[3].name).toBe("Untitled website");
    expect(toProjects([{ id: "a", name: null, created_at: "2026-10-01T00:00:00Z" }], [])[0].name).toBe("Untitled agent");
  });
  it("keeps a website's generation notes (text only) and stored trust score", () => {
    const w = toProjects([], websites).find((x) => x.id === "w1")!;
    expect(w.website).toEqual({ notes: ["a note"], trustScore: 92 });
    expect(toProjects([], websites).find((x) => x.id === "w2")!.website).toEqual({ notes: [], trustScore: null });
  });
  it("is empty for an account with nothing", () => expect(toProjects([], [])).toEqual([]));
});

describe("which project is shown", () => {
  const projects = toProjects(agents, websites);
  it("is null only when there are no projects", () => {
    expect(pickProject({ projects: [], seconds: {}, chosen: "agent:a1" })).toBeNull();
    expect(pickProject({ projects, seconds: {}, chosen: null })).not.toBeNull();
  });
  it("is the one with the most time spent on it", () => {
    const seconds = { [projectKey("website", "w2")]: 5000, [projectKey("agent", "a1")]: 900, [projectKey("agent", "a2")]: 100 };
    expect(pickProject({ projects, seconds, chosen: null })!.key).toBe("website:w2");
  });
  it("is the newest when no time has been spent, and breaks a tie by the newest", () => {
    expect(pickProject({ projects, seconds: {}, chosen: null })!.key).toBe("agent:a2");
    expect(pickProject({ projects, seconds: { "agent:a1": 60, "website:w1": 60 }, chosen: null })!.key).toBe("website:w1");
  });
  it("is the choice made on the page while it still exists, and falls back when it was deleted", () => {
    const seconds = { "website:w2": 5000 };
    expect(pickProject({ projects, seconds, chosen: "agent:a1" })!.key).toBe("agent:a1");
    expect(pickProject({ projects, seconds, chosen: "agent:gone" })!.key).toBe("website:w2");
  });
});

describe("which rules belong to a project", () => {
  const rows = [
    { id: "all", agent_id: null, api_key_id: null },
    { id: "a1", agent_id: "a1", api_key_id: null },
    { id: "a2", agent_id: "a2", api_key_id: null },
    { id: "key", agent_id: null, api_key_id: "k1" },
  ];
  const [agent1, , , website] = [toProjects(agents, websites).find((p) => p.id === "a1")!, 0, 0, toProjects(agents, websites).find((p) => p.id === "w1")!];
  it("for an agent: its own and the ones for all agents, never another agent's or an API key's", () => {
    expect(rulesFor(agent1, rows).map((r) => r.id)).toEqual(["all", "a1"]);
  });
  it("for a website: the rules for all agents, which its pages are checked against", () => {
    expect(rulesFor(website, rows).map((r) => r.id)).toEqual(["all"]);
  });
  it("without a project: everything, as before", () => {
    expect(rulesFor(undefined, rows)).toHaveLength(4);
    expect(rulesFor(null, rows)).toHaveLength(4);
  });
});

describe("the choice made on the page", () => {
  beforeEach(() => sessionStorage.clear());
  it("is remembered per account for this visit, and forgotten when Inner Control is opened from the welcome screen", () => {
    expect(readChoice("u1")).toBeNull();
    writeChoice("u1", "agent:a1"); writeChoice("u2", "website:w1");
    expect(readChoice("u1")).toBe("agent:a1");
    expect(sessionStorage.getItem(choiceStorageKey("u2"))).toBe("website:w1");
    sessionStorage.setItem("something-else", "kept");
    forgetChoices();
    expect(readChoice("u1")).toBeNull(); expect(readChoice("u2")).toBeNull();
    expect(sessionStorage.getItem("something-else")).toBe("kept");
  });
});
