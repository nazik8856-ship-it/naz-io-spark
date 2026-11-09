// The website's one data cache (react-query). It lives here, not in App.tsx, so the session reset (session-reset.ts) can clear it
// when the person signs out, a different person signs in, or the active account changes.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();
