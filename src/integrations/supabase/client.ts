// src/integrations/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Hardcoded to guarantee production always targets the correct backend,
// regardless of hosting-provider environment variables.
const SUPABASE_URL = "https://qaeduinfirtljnbecyzq.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhZWR1aW5maXJ0bGpuYmVjeXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MjMwMTcsImV4cCI6MjA4NzE5OTAxN30.d9LUMaj0_2C0802M2oRHYny6coTPQuHJ3DmF-crthU4";

export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const SUPABASE_ANON = SUPABASE_ANON_KEY;

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
