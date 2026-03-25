import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const AuthGuard = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="border-4 border-foreground/20 p-8 text-center space-y-3 max-w-sm">
          <div className="w-10 h-10 border-4 border-foreground border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-mono text-foreground text-lg font-bold">Restoring your session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};

export default AuthGuard;