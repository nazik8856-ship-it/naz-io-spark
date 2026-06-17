// src/integrations/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// ─── Resolve env vars ─────────────────────────────────────────────────────────
// Supports both VITE_SUPABASE_ANON_KEY (new) and VITE_SUPABASE_PUBLISHABLE_KEY
// (legacy Lovable name) so the app never hard-crashes due to a name mismatch.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://qaeduinfirtljnbecyzq.supabase.co"; // current project fallback — keeps generation working on stale builds

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhZWR1aW5maXJ0bGpuYmVjeXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MjMwMTcsImV4cCI6MjA4NzE5OTAxN30.d9LUMaj0_2C0802M2oRHYny6coTPQuHJ3DmF-crthU4"; // current project anon key fallback

export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const SUPABASE_ANON = SUPABASE_ANON_KEY;

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
