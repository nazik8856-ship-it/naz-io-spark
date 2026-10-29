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
// Data encryption, front 4: writes to encrypted tables go through the encrypted-write edge function (ocWrite, approvalSignoff).
// In the screen tests they are handed to the mocked database too; src/test/encrypted-write.test.ts checks the real ones.
vi.mock("@/lib/encrypted-write", async () => {
  const { supabase } = await import("@/integrations/supabase/client");
  const db = supabase as unknown as { from: (t: string) => unknown; rpc: (f: string, a: unknown) => unknown };
  return {
    ocWrite: (table: string) => db.from(table),
    approvalSignoff: (x: { approval_id: string; vote: string; comment?: string | null; reason_code?: string | null }) =>
      db.rpc("record_approval_signoff", { _approval_id: x.approval_id, _vote: x.vote, _comment: x.comment ?? null, _reason_code: x.reason_code ?? null }),
  };
});
