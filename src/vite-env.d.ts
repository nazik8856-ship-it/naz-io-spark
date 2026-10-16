/// <reference types="vite/client" />

// Injected by vite.config.ts's `define` — the commit SHA (or timestamp
// fallback) this bundle was built from. See useBuildFreshnessCheck.ts.
declare const __BUILD_ID__: string;

// A parity test imports a pure edge-function module whose only URL import is the Deno-style
// supabase client. The browser type-check cannot resolve URL imports, so declare it as opaque.
declare module "https://esm.sh/@supabase/supabase-js@2" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type SupabaseClient = any;
}
