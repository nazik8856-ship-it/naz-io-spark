// src/integrations/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// ─── Resolve env vars ─────────────────────────────────────────────────────────
// Supports both VITE_SUPABASE_ANON_KEY (new) and VITE_SUPABASE_PUBLISHABLE_KEY
// (legacy Lovable name) so the app never hard-crashes due to a name mismatch.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://gowbbsqwkciicsxyndyq.supabase.co"; // safe fallback — prevents createClient throw

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_a7OIeKvIw8hu5Uqil6xSSA_dUTqZOzt"; // safe fallback — prevents createClient throw

if (
  !import.meta.env.VITE_SUPABASE_URL ||
  (!import.meta.env.VITE_SUPABASE_ANON_KEY && !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
) {
  console.warn(
    "[NazAI] Supabase env vars not detected. " +
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables. " +
      "The UI will still render but database calls will fail until this is fixed.",
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
