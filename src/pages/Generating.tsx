import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

const Generating = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/", { replace: true });
    } else {
      // Auth confirmed — redirect to dashboard
      navigate("/dashboard", { replace: true });
    }
  }, [user, loading, navigate]);

  // Branded loading screen while auth resolves
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-6"
      style={{ background: "#020617" }}
    >
      <Loader2
        className="w-10 h-10 animate-spin"
        style={{ color: "#00f0ff" }}
      />
      <p
        className="text-sm font-bold uppercase tracking-[0.2em]"
        style={{ color: "rgba(255,255,255,0.4)" }}
      >
        Initialising NazAI…
      </p>
    </div>
  );
};

export default Generating;
