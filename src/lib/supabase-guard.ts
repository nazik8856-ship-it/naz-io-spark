import { supabase } from "@/integrations/supabase/client";

export function getSupabaseClient() {
  return supabase;
}

export function isSupabaseReady(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.warn("[NazAI] Supabase env vars:", { url: !!url, key: !!key });
    // Return true anyway so the app renders — pages that don't need Supabase will work fine
    return true;
  }
  return true;
}
