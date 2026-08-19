import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense } from "react";
import EntranceSplash from "@/components/EntranceSplash";
import PaymentWindow from "@/components/payments/PaymentWindow";
import OutOfCreditsModal from "@/components/payments/OutOfCreditsModal";
import OAuthReturnHandler from "@/components/OAuthReturnHandler";
import IntegrationOAuthMessageBridge from "@/components/integrations/IntegrationOAuthMessageBridge";

// ─── Route Components ─────────────────────────────────────────────────────────
// Retry lazy imports once after a hard reload when the browser is holding a
// stale chunk hash from a previous deploy ("Failed to fetch dynamically
// imported module"). Without this, the app white-screens until the user
// manually refreshes.
const lazyWithReload = <T,>(factory: () => Promise<{ default: React.ComponentType<T> }>) =>
  lazy(() =>
    factory().catch((err) => {
      const msg = String(err?.message || err);
      if (/dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)) {
        const key = "__nazai_chunk_reload__";
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
          return new Promise<never>(() => {});
        }
      }
      throw err;
    }),
  );

const Workflower = lazyWithReload(() => import("./pages/Workflower"));
const Workspace = lazyWithReload(() => import("./pages/Workspace"));
const Signup = lazyWithReload(() => import("./pages/Signup"));
const AuthCallback = lazyWithReload(() => import("./pages/AuthCallback"));
const Dashboard = lazyWithReload(() => import("./pages/Dashboard"));
const Generator = lazyWithReload(() => import("./pages/Generator"));
const GeneratorHome = lazyWithReload(() => import("./pages/GeneratorHome"));
const GenerationWorkspace = lazyWithReload(() => import("./pages/GenerationWorkspace"));
const Generating = lazyWithReload(() => import("./pages/Generating"));
const Pricing = lazyWithReload(() => import("./pages/Pricing"));
const Unsubscribe = lazyWithReload(() => import("./pages/Unsubscribe"));
const OAuthConsent = lazyWithReload(() => import("./pages/OAuthConsent"));
const WebsitePreview = lazyWithReload(() => import("./pages/WebsitePreview"));
const GeneratedDashboard = lazyWithReload(() => import("./pages/GeneratedDashboard"));
const Privacy = lazyWithReload(() => import("./pages/Privacy"));
const Terms = lazyWithReload(() => import("./pages/Terms"));
const Insights = lazyWithReload(() => import("./pages/Insights"));
const ControlSystem = lazyWithReload(() => import("./pages/ControlSystem"));
const ControlApprovals = lazyWithReload(() => import("./pages/ControlApprovals"));
const ControlSafetyRules = lazyWithReload(() => import("./pages/ControlSafetyRules"));
const ControlPolicy = lazyWithReload(() => import("./pages/ControlPolicy"));
const ControlPendingDecisions = lazyWithReload(() => import("./pages/ControlPendingDecisions"));
const ControlIncidents = lazyWithReload(() => import("./pages/ControlIncidents"));
const ControlRuleSimulator = lazyWithReload(() => import("./pages/ControlRuleSimulator"));
const ControlHealthView = lazyWithReload(() => import("./pages/ControlHealthView"));
const ControlChangeLog = lazyWithReload(() => import("./pages/ControlChangeLog"));
const ControlCoverageGaps = lazyWithReload(() => import("./pages/ControlCoverageGaps"));
const ControlWebhooks = lazyWithReload(() => import("./pages/ControlWebhooks"));
const ControlComplianceReport = lazyWithReload(() => import("./pages/ControlComplianceReport"));



const queryClient = new QueryClient();

// Obsidian loading skeleton
const PageSkeleton = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: "#020617" }}>
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#00A3FF]/30 border-t-[#00A3FF] rounded-full animate-spin" />
      <p className="text-sm text-white/30 font-medium">Loading…</p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <main className="min-h-screen bg-[#020617] selection:bg-[#00A3FF]/30">
          <IntegrationOAuthMessageBridge />
          <EntranceSplash>
            <OAuthReturnHandler />
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                {/* Core Routes */}
                <Route path="/" element={<Workflower />} />
                <Route path="/workflower" element={<Workflower />} />
                <Route path="/workspace" element={<Workspace />} />
                <Route path="/generating" element={<Generating />} />

                {/* Auth Routes */}
                <Route path="/signup" element={<Signup />} />
                <Route path="/login" element={<Signup />} />
                <Route path="/auth/callback" element={<AuthCallback />} />

                {/* Mission Generator & Dashboard */}
                <Route path="/generate" element={<Generator />} />
                <Route path="/generator-home" element={<GeneratorHome />} />
                <Route path="/generation-workspace" element={<GenerationWorkspace />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/website-preview/:id" element={<WebsitePreview />} />
                <Route path="/generated/:kind/:id" element={<GeneratedDashboard />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/insights" element={<Insights />} />
                <Route path="/control-system" element={<ControlSystem />} />
                <Route path="/control-system/approvals" element={<ControlApprovals />} />
                <Route path="/control-system/safety-rules" element={<ControlSafetyRules />} />
                <Route path="/control-system/policy" element={<ControlPolicy />} />
                <Route path="/control-system/pending" element={<ControlPendingDecisions />} />
                <Route path="/control-system/incidents" element={<ControlIncidents />} />
                <Route path="/control-system/simulator" element={<ControlRuleSimulator />} />
                <Route path="/control-system/health" element={<ControlHealthView />} />
                <Route path="/control-system/changes" element={<ControlChangeLog />} />
                <Route path="/control-system/coverage" element={<ControlCoverageGaps />} />
                <Route path="/control-system/webhooks" element={<ControlWebhooks />} />
                <Route path="/control-system/compliance" element={<ControlComplianceReport />} />



                {/* OAuth 2.1 consent screen for MCP clients (ChatGPT, Claude, etc.) */}
                <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />

                {/* Nested Dashboard Routes */}
                <Route path="/dashboard/*" element={<Dashboard />} />

                {/* Catch-all Redirect */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>

              <Toaster />
              <PaymentWindow />
              <OutOfCreditsModal />
            </Suspense>
          </EntranceSplash>
        </main>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
