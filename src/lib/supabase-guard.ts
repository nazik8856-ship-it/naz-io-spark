// Singleton guard: ensures Supabase env vars are available
let isReady = false;

export function checkSupabaseEnv(): { ready: boolean; missing: string[] } {
  if (isReady) return { ready: true, missing: [] };

  const missing: string[] = [];
  if (!import.meta.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');

  if (missing.length === 0) isReady = true;
  return { ready: isReady, missing };
}
