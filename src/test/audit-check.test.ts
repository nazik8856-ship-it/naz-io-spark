// The CI dependency audit (scripts/audit-check.mjs): every high or critical advisory fails the build unless an in-date exemption
// names that exact advisory.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { blockingAdvisories } from "../../scripts/audit-check.mjs";

const advisory = (id: string, severity: string) => ({ source: 1, title: `t ${id}`, url: `https://github.com/advisories/${id}`, severity });
const report = {
  vulnerabilities: {
    picomatch: { via: [advisory("GHSA-fc5q-39xc-vjpf", "high")] },
    vite: { via: ["picomatch"] },
    lodash: { via: [advisory("GHSA-aaaa-bbbb-cccc", "critical")] },
    "react-router": { via: [advisory("GHSA-wrjc-x8rr-h8h6", "moderate")] },
  },
};
const EXEMPT = [{ id: "GHSA-fc5q-39xc-vjpf", package: "picomatch", reason: "r", expires: "2026-12-18" }];

describe("the dependency audit", () => {
  it("an in-date exemption covers its own advisory and nothing else; moderate ones never fail", () => {
    expect(blockingAdvisories(report, EXEMPT, "2026-11-18").map((b: { id: string }) => b.id)).toEqual(["ghsa-aaaa-bbbb-cccc"]);
  });

  it("with no exemption, or once it expires, the advisory fails again", () => {
    expect(blockingAdvisories(report, [], "2026-11-18")).toHaveLength(2);
    expect(blockingAdvisories(report, EXEMPT, "2026-12-19")).toHaveLength(2);
  });

  it("every exemption on file names one advisory, why, and an expiry date; CI runs the script", () => {
    const list = JSON.parse(readFileSync(".github/audit-exemptions.json", "utf8")) as { id: string; package: string; reason: string; expires: string }[];
    for (const e of list) {
      expect(e.id).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(e.reason.length).toBeGreaterThan(40);
      expect(e.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain("node scripts/audit-check.mjs");
  });
});
