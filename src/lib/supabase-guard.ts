import { supabase } from "@/integrations/supabase/client";

let verified = false;

export function getSupabaseClient() {
  if (!verified) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      console.warn("[NazAI] Supabase env vars not yet available:", { url: !!url, key: !!key });
      return null;
    }
    verified = true;
  }
  return supabase;
}

export function isSupabaseReady(): boolean {
  return !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
}
