import { describe, expect, it, vi, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LiveAgentChat from "@/components/agents/LiveAgentChat";

beforeAll(() => {
  // jsdom has no layout; the composer only reads scrollHeight to auto-grow.
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
});

const base = { agentId: "a1", name: "Flight Finder Pro", turns: [], suggestions: [], fullSpec: "spec" };
const box = () => screen.getByLabelText("Message Flight Finder Pro") as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(box(), { target: { value: v } });
const enter = (opts: object = {}) => fireEvent.keyDown(box(), { key: "Enter", ...opts });

describe("chat composer", () => {
  it("shows the agent's name in the placeholder", () => {
    render(<LiveAgentChat {...base} streaming={false} onSend={() => {}} />);
    expect(box().placeholder).toBe("Talk to Flight Finder Pro…");
  });

  it("never collapses to zero height when the browser reports no scrollHeight (regression: the box vanished)", () => {
    render(<LiveAgentChat {...base} streaming={false} onSend={() => {}} />);
    type("a long enough message");
    expect(box().style.height).not.toBe("0px");
    expect(box().style.minHeight).toBe("44px");
  });

  it("grows with the text up to six lines, and no further", () => {
    render(<LiveAgentChat {...base} streaming={false} onSend={() => {}} />);
    Object.defineProperty(box(), "scrollHeight", { configurable: true, get: () => 400 });
    type("many\nlines\n".repeat(20));
    expect(box().style.height).toBe("132px");
    Object.defineProperty(box(), "scrollHeight", { configurable: true, get: () => 66 });
    type("three\nlines\nhere");
    expect(box().style.height).toBe("66px");
  });

  it("Enter sends the trimmed message and clears the box; Shift+Enter does not send", () => {
    const onSend = vi.fn();
    render(<LiveAgentChat {...base} streaming={false} onSend={onSend} />);
    type("  make the hero bolder  ");
    enter({ shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    enter();
    expect(onSend).toHaveBeenCalledWith("make the hero bolder");
    expect(box().value).toBe("");
  });

  it("the send button is disabled for an empty or whitespace-only message", () => {
    render(<LiveAgentChat {...base} streaming={false} onSend={() => {}} />);
    const btn = screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    type("   ");
    expect(btn.disabled).toBe(true);
    type("hello");
    expect(btn.disabled).toBe(false);
  });

  it("while a request is running the message is KEPT, nothing is sent, and the user is told why", () => {
    const onSend = vi.fn();
    render(<LiveAgentChat {...base} streaming={true} onSend={onSend} />);
    expect(box().placeholder).toMatch(/Working on it/);
    expect(screen.queryByRole("status")).toBeNull();
    type("now add pricing");
    enter();
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe("now add pricing");
    expect(screen.getByRole("status").textContent).toMatch(/your message is kept/);
    expect(screen.getByTestId("chat-composer").getAttribute("data-busy")).toBe("true");
  });

  it("the hint clears when the user edits, and when the request finishes the kept message can be sent", () => {
    const onSend = vi.fn();
    const { rerender } = render(<LiveAgentChat {...base} streaming={true} onSend={onSend} />);
    type("now add pricing");
    enter();
    expect(screen.getByRole("status")).toBeTruthy();
    rerender(<LiveAgentChat {...base} streaming={false} onSend={onSend} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(box().value).toBe("now add pricing");
    enter();
    expect(onSend).toHaveBeenCalledWith("now add pricing");
  });
});
