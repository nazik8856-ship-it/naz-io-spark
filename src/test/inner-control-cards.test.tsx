import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import YourRulesCard from "@/components/control/dashboard/YourRulesCard";
import RecentActivityCard from "@/components/control/dashboard/RecentActivityCard";
import LiveAgentChat from "@/components/agents/LiveAgentChat";
import { countRules, type RuleItem } from "@/lib/inner-control-ui";

const rule = (o: Partial<RuleItem> = {}): RuleItem => ({
  key: "hard:h1", id: "h1", kind: "hard", name: "Never email more than 1 person", effect: "Always blocks",
  scope: "Sending email · All agents", status: "active", shadow: false, createdAt: "2026-10-01T00:00:00Z", ...o,
});

function cardProps(rules: RuleItem[], over: Partial<Parameters<typeof YourRulesCard>[0]> = {}) {
  return {
    rules, counts: countRules(rules), loading: false, canWrite: true, dualControl: false, busyKey: null,
    onAdd: vi.fn(), onTemplates: vi.fn(), onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn(), onAsk: vi.fn(), ...over,
  };
}

describe("YourRulesCard", () => {
  it("lists each rule with type, status and Edit / Disable / Delete", () => {
    const p = cardProps([rule(), rule({ key: "safety:s1", id: "s1", kind: "safety", name: "Competitor mentions", status: "disabled" })]);
    render(<YourRulesCard {...p} />);
    const hardRow = screen.getByTestId("rule-row-hard:h1");
    expect(within(hardRow).getByText("Hard rule")).toBeTruthy();
    expect(within(hardRow).getByText("Active")).toBeTruthy();
    fireEvent.click(within(hardRow).getByRole("button", { name: /^Edit rule/ }));
    fireEvent.click(within(hardRow).getByRole("button", { name: /^Disable rule/ }));
    expect(p.onEdit).toHaveBeenCalledWith(p.rules[0]);
    expect(p.onToggle).toHaveBeenCalledWith(p.rules[0]);
    const safetyRow = screen.getByTestId("rule-row-safety:s1");
    expect(within(safetyRow).getByText("Disabled")).toBeTruthy();
    expect(within(safetyRow).getByRole("button", { name: /^Enable rule/ })).toBeTruthy();
  });

  it("asks before deleting and only deletes on confirm", () => {
    const p = cardProps([rule()]);
    render(<YourRulesCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete rule/ }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete rule" }));
    expect(p.onDelete).toHaveBeenCalledTimes(1);
  });

  it("says a deletion is only requested when dual control is on", () => {
    render(<YourRulesCard {...cardProps([rule()], { dualControl: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete rule/ }));
    expect(screen.getByRole("button", { name: "Request deletion" })).toBeTruthy();
  });

  it("marks shadow rules as observe-only", () => {
    render(<YourRulesCard {...cardProps([rule({ shadow: true })])} />);
    expect(screen.getByText("Shadow")).toBeTruthy();
  });

  it("has a prominent Add rule button", () => {
    const p = cardProps([rule()]);
    render(<YourRulesCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Add rule/ }));
    expect(p.onAdd).toHaveBeenCalled();
  });

  it("shows a helpful empty state with both ways to start", () => {
    const p = cardProps([]);
    render(<YourRulesCard {...p} />);
    expect(screen.getByTestId("rules-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start from a policy template" }));
    fireEvent.click(screen.getByRole("button", { name: "Write my own rule" }));
    expect(p.onTemplates).toHaveBeenCalled();
    expect(p.onAdd).toHaveBeenCalled();
  });

  it("hides every change button from a view-only member", () => {
    render(<YourRulesCard {...cardProps([rule()], { canWrite: false })} />);
    expect(screen.queryByRole("button", { name: /Add rule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete rule/ })).toBeNull();
    expect(screen.getByText(/view-only access/i)).toBeTruthy();
  });
});

describe("RecentActivityCard", () => {
  const item = { id: "d1", at: new Date().toISOString(), verdict: "Blocked", tone: "bad" as const, title: "Send email to all customers", reason: "A hard rule always blocks this.", ruleId: "h1", ruleName: "Never email more than 1 person", question: 'Why was "Send email to all customers" blocked?' };
  it("links a row to its rule and to the chat", () => {
    const onShowRule = vi.fn();
    const onAsk = vi.fn();
    render(<RecentActivityCard items={[item]} loading={false} onShowRule={onShowRule} onAsk={onAsk} onViewAll={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Rule: Never email/ }));
    expect(onShowRule).toHaveBeenCalledWith("h1");
    fireEvent.click(screen.getByRole("button", { name: /Ask the chat/ }));
    expect(onAsk).toHaveBeenCalledWith(item.question);
  });
  it("explains what will appear when there is nothing yet", () => {
    render(<RecentActivityCard items={[]} loading={false} onShowRule={() => {}} onAsk={() => {}} onViewAll={() => {}} />);
    expect(screen.getByTestId("activity-empty").textContent).toMatch(/No decisions yet/);
  });
});

describe("LiveAgentChat prefill", () => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  const base = { agentId: "x", name: "Chat", turns: [], suggestions: [], streaming: false, fullSpec: "", onSend: vi.fn() };
  it("puts the text in the box without sending it, and re-applies on a new nonce", () => {
    const { rerender } = render(<LiveAgentChat {...base} prefill={{ text: "Why was it blocked?", nonce: 1 }} />);
    const box = screen.getByLabelText("Message Chat") as HTMLTextAreaElement;
    expect(box.value).toBe("Why was it blocked?");
    expect(base.onSend).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "edited" } });
    rerender(<LiveAgentChat {...base} prefill={{ text: "Why was it blocked?", nonce: 2 }} />);
    expect(box.value).toBe("Why was it blocked?");
  });
  it("shows the live status where the reply will appear while a task runs", () => {
    render(
      <LiveAgentChat {...base} streaming turns={[{ role: "user", content: "run it" }, { role: "assistant", content: "" }]}
        executionLog={<div>Checking 2 active rules</div>} />,
    );
    expect(screen.getByText("Checking 2 active rules")).toBeTruthy();
  });
});
