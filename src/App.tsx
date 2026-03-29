import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
 nazai-improvements
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import SharedWebsite from "./pages/SharedWebsite";
import AuthCallback from "./pages/AuthCallback";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Auth from "./pages/Auth";
import Generator from "./pages/Generator";


import { AuthProvider } from "./hooks/useAuth";
 main

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        nazai-improvements
        <AuthProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/" element={<Index />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route element={<AuthGuard />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/dashboard/create" element={<Dashboard />} />
                <Route path="/dashboard/projects" element={<Dashboard />} />
                <Route path="/dashboard/trash" element={<Dashboard />} />
                <Route path="/generate" element={<Generator />} />
              </Route>
              <Route path="/share/:id" element={<SharedWebsite />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>

        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/generate" element={<Generator />} />
            <Route path="/dashboard" element={<Navigate to="/generate" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
 main
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
