import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

// The standalone "Welcome back" signup page has been removed.
// Authentication is handled exclusively through the AuthModal opened from the
// landing page ("Start Free Mission"). This route now redirects:
//   - authenticated users  -> /dashboard
//   - unauthenticated users -> / (where the AuthModal can be triggered)
const Signup = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    navigate(user ? "/dashboard" : "/", { replace: true });
  }, [user, loading, navigate]);

  return null;
};

export default Signup;
