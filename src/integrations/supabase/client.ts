// src/integrations/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Hardcoded to guarantee production always targets the correct backend,
// regardless of hosting-provider environment variables.
export const SUPABASE_URL = "https://ekuodpaaiugzywfcmjeo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrdW9kcGFhaXVnenl3ZmNtamVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NjIzNzgsImV4cCI6MjEwMzQzODM3OH0.o1nkPj83mwsRMU2Z_gomeLKHzYwNWxVtRZEysV6PTN4";

export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const SUPABASE_ANON = SUPABASE_ANON_KEY;

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
