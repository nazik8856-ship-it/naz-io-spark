import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// A version-mismatch banner (src/hooks/useBuildFreshnessCheck.ts) needs a
// build identifier baked into the JS bundle AND separately fetchable as a
// static file from the live server -- that's how a tab that's been open
// since before a deploy can tell a newer bundle now exists instead of
// silently keeping the SPA's stale in-memory JS running forever. Vercel
// sets VERCEL_GIT_COMMIT_SHA at build time; the timestamp fallback keeps
// local/non-Vercel builds functional too.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());

function buildIdFilePlugin() {
  return {
    name: "nazai-build-id-file",
    generateBundle() {
      this.emitFile({ type: "asset" as const, fileName: "build-id.txt", source: BUILD_ID });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mcpPlugin(), buildIdFilePlugin(), mode === "development" && componentTagger()].filter(Boolean),
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
