import "@testing-library/jest-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Data encryption, front 3: screens read Outer Control content through the outer-control-read edge function (ocRead). In the
// screen tests that read is handed to the same mocked database the test sets up, so each test keeps describing the rows it
// shows; src/test/outer-control-read.test.ts checks ocRead itself, and field-encryption.test.ts that screens use it.
import { vi } from "vitest";
vi.mock("@/lib/outer-control-read", async () => {
  const { supabase } = await import("@/integrations/supabase/client");
  return { ocRead: (table: string) => (supabase as unknown as { from: (t: string) => unknown }).from(table) };
});
