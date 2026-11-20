// Inner Control Day 3 (#175): the secondary Control pages pruned by real usage, as the owner approved. The 11 pages nobody opened
// and no job needs are out of the "All pages" menu; nothing is deleted, and every hidden page still opens by its link.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ControlPagesGrid, HIDDEN_FROM_MENU, MENU_GROUPS } from "@/components/control/dashboard/ControlPagesMenu";

const KEPT_FOR_A_JOB = [
  "/control-system/policy-changes", "/control-system/team", "/control-system/account-data", "/control-system/incidents",
  "/control-system/knowledge-base", "/control-system/decision-history", "/control-system/webhooks",
];

describe("the All pages menu", () => {
  it("leaves out exactly the 11 approved pages", () => {
    expect(HIDDEN_FROM_MENU.size).toBe(11);
    const shown = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.path));
    for (const p of HIDDEN_FROM_MENU) expect(shown).not.toContain(p);
    expect(shown).toHaveLength(18);
  });

  it("keeps the pages a job needs, and every visited page", () => {
    const shown = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.path));
    for (const p of [...KEPT_FOR_A_JOB, "/control-system/api-keys", "/control-system/approvals", "/control-system/coverage", "/control-system/spend-safety"]) {
      expect(shown).toContain(p);
    }
  });

  it("every hidden page keeps its route: it still opens by its link", () => {
    const app = readFileSync(join(__dirname, "../App.tsx"), "utf8");
    for (const p of HIDDEN_FROM_MENU) expect(app).toContain(`path="${p}"`);
  });

  it("the menu shows no hidden page and no empty group", () => {
    render(<ControlPagesGrid onNavigate={() => {}} />);
    expect(screen.queryByText("Value report")).toBeNull();
    expect(screen.queryByText("Live activity")).toBeNull();
    expect(screen.getByText("Team")).toBeTruthy();
    expect(MENU_GROUPS.every((g) => g.items.length > 0)).toBe(true);
  });
});
