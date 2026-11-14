// Outer Control: the looks and the file menu on a finished result (docs/outer-control-outputs.md).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FinalArtifactView from "@/components/control/outer/FinalArtifactView";
import { taskArtifact } from "./artifact-fixture";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));

const TEXT = "SUMMARY\nReturns take thirty days.\n\nDETAILS\n- Premium: 30 days\n- Standard: 14 days";
let blobs: Blob[] = [];
let downloads: string[] = [];

beforeEach(() => {
  blobs = []; downloads = [];
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => { blobs.push(b); return "blob:test"; };
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openMenu = () => { fireEvent.click(screen.getByTestId("download-as")); };

describe("the look of a result", () => {
  it("opens in the look chosen before the Task started, in a frame that can run nothing", () => {
    render(<FinalArtifactView artifact={taskArtifact(TEXT, { template: "executive" })} kind="task" />);
    expect(screen.getByTestId("look-executive").getAttribute("aria-checked")).toBe("true");
    const frame = screen.getByTestId("look-preview") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("Returns take thirty days.");
    expect(frame.getAttribute("srcdoc")).not.toContain('<aside class="bottom'); // a plain text result has no "answer" section to lift
    expect(screen.queryByTestId("final-artifact-output")).toBeNull();
  });

  it("without a choice it is the original look, as before: the plain result, no frame", () => {
    render(<FinalArtifactView artifact={taskArtifact(TEXT)} kind="task" />);
    expect(screen.getByTestId("look-nazai").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("look-preview")).toBeNull();
    expect(screen.getByTestId("final-artifact-output").textContent).toContain("Returns take thirty days.");
  });

  it("the viewer can switch to any of the five looks and back", () => {
    render(<FinalArtifactView artifact={taskArtifact(TEXT)} kind="task" />);
    for (const id of ["executive", "editorial", "brief", "data"]) {
      fireEvent.click(screen.getByTestId(`look-${id}`));
      expect(screen.getByTestId(`look-${id}`).getAttribute("aria-checked")).toBe("true");
      expect(screen.getByTestId("look-preview").getAttribute("srcdoc")).toContain("Returns take thirty days.");
    }
    fireEvent.click(screen.getByTestId("look-nazai"));
    expect(screen.queryByTestId("look-preview")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });

  it("a look that is not one of the five is ignored, not trusted", () => {
    const bad = { ...taskArtifact(TEXT), template: "<script>" };
    // an artifact with an unknown look is not a valid artifact at all
    const { container } = render(<FinalArtifactView artifact={bad} kind="task" />);
    expect(container.innerHTML).toBe("");
  });

  it("the web page download follows the look that is showing", () => {
    render(<FinalArtifactView artifact={taskArtifact(TEXT)} kind="task" />);
    fireEvent.click(screen.getByTestId("look-editorial"));
    fireEvent.click(screen.getByTestId("download-result"));
    expect(downloads).toEqual(["nazai-result-w1.html"]);
    expect(blobs[0].type).toBe("text/html");
  });
});

describe("the file menu", () => {
  it("offers Word, PDF, Excel, CSV and Markdown", async () => {
    render(<FinalArtifactView artifact={taskArtifact(TEXT)} kind="task" />);
    openMenu();
    for (const k of ["docx", "pdf", "xlsx", "csv", "md"]) expect(await screen.findByTestId(`download-${k}`)).toBeTruthy();
    expect(screen.queryByTestId("download-asked")).toBeNull();
  });

  it("a file type the request asked for is first and marked", async () => {
    render(<FinalArtifactView artifact={taskArtifact(TEXT, { request: "Summarise the returns policy as an Excel spreadsheet" })} kind="task" />);
    openMenu();
    const items = await screen.findAllByRole("menuitem");
    expect(items[0].getAttribute("data-testid")).toBe("download-xlsx");
    expect(screen.getByTestId("download-asked").textContent).toBe("asked for");
  });

  it("choosing a file type downloads that file, with its own name and type", async () => {
    const mimes: Record<string, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv;charset=utf-8", md: "text/markdown;charset=utf-8",
    };
    for (const k of Object.keys(mimes)) {
      cleanup(); blobs = []; downloads = [];
      render(<FinalArtifactView artifact={taskArtifact(TEXT, { template: "brief" })} kind="task" />);
      openMenu();
      fireEvent.click(await screen.findByTestId(`download-${k}`));
      await waitFor(() => expect(downloads).toEqual([`nazai-result-w1.${k}`]));
      expect(blobs[0].type).toBe(mimes[k]);
      expect(blobs[0].size).toBeGreaterThan(100);
    }
  });

  it("a result a standard-font PDF can not hold opens the print dialog instead of a broken file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // jsdom has no print dialog and says so
    render(<FinalArtifactView artifact={taskArtifact("مرحبا بكم في نازاي، هذا ملخص سياسة الإرجاع لعملاء النسخة المميزة.")} kind="task" />);
    openMenu();
    fireEvent.click(await screen.findByTestId("download-pdf"));
    await waitFor(() => expect(document.querySelector('iframe[aria-hidden="true"]')).not.toBeNull());
    expect(downloads).toEqual([]);
    // Word, Excel and the rest hold any script
    cleanup();
    render(<FinalArtifactView artifact={taskArtifact("مرحبا بكم في نازاي")} kind="task" />);
    openMenu();
    fireEvent.click(await screen.findByTestId("download-docx"));
    await waitFor(() => expect(downloads).toEqual(["nazai-result-w1.docx"]));
  });
});
