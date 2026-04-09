import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Auth as SupabaseAuth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";

const Auth = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for auth state changes (Login/Logout)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate("/dashboard", { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-black/40 backdrop-blur-xl border border-white/10 p-8 rounded-2xl shadow-[0_0_50px_rgba(34,197,94,0.1)]">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tighter">AGENT IDENTIFICATION</h1>
          <p className="text-slate-400 text-sm mt-2">Enter credentials to access NazAI Global Systems</p>
        </div>

        <SupabaseAuth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: "#22c55e",
                  brandAccent: "#16a34a",
                  inputBackground: "transparent",
                  inputText: "white",
                  inputPlaceholder: "#64748b",
                },
              },
            },
            className: {
              button: "rounded-lg font-bold hover:shadow-[0_0_15px_rgba(34,197,94,0.4)] transition-all",
              input: "border-white/10 focus:border-green-500/50 transition-colors",
            },
          }}
          providers={["google"]}
          theme="dark"
        />
      </div>
    </div>
  );
};

export default Auth;
