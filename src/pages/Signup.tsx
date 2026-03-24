import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Sparkles, Loader2, Coins } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import Logo from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";

const Signup = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "survey1" | "survey2" | "welcome">("form");
  const [formData, setFormData] = useState({ name: "", email: "", password: "" });
  const [survey1, setSurvey1] = useState<string | null>(null);
  const [survey1Other, setSurvey1Other] = useState("");
  const [survey2, setSurvey2] = useState<string | null>(null);
  const [survey2Other, setSurvey2Other] = useState("");

  useEffect(() => {
    if (user) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const [transitioning, setTransitioning] = useState(false);

  const handleSurveyComplete = () => {
    setStep("welcome");
    // After showing welcome, trigger portal exit then navigate
    setTimeout(() => {
      setTransitioning(true);
      setTimeout(() => navigate("/dashboard"), 900);
    }, 2500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // First try signing in (returning user)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: formData.email,
      password: formData.password,
    });

    if (!signInError) {
      setLoading(false);
      navigate("/dashboard");
      return;
    }

    // If sign-in failed, try signing up (new user)
    const { error: signUpError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: { full_name: formData.name },
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);

    if (signUpError) {
      toast({ title: "Authentication failed", description: signUpError.message, variant: "destructive" });
    } else {
      navigate("/dashboard");
    }
  };

  const handleSocialSignup = async (provider: "google" | "apple") => {
    setSocialLoading(provider);
    const { error } = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin + "/auth/callback",
    });
    if (error) {
      toast({ title: "Sign in failed", description: String(error), variant: "destructive" });
      setSocialLoading(null);
    }
  };

  // Survey 1: How did you hear about us?
  if (step === "survey1") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-float opacity-60" />
          <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-glow-secondary/20 rounded-full blur-3xl animate-float-delayed opacity-40" />
        </div>
        <div className="relative z-10 p-8 rounded-3xl glass border-glow max-w-md w-full mx-6">
          <div className="mb-6"><Logo size="lg" linkTo="/" /></div>
          <h2 className="text-2xl font-bold mb-2">How did you hear about us?</h2>
          <p className="text-muted-foreground mb-6 text-sm">We'd love to know where you found us.</p>
          <div className="space-y-3">
            {["Youtube", "Tiktok", "Instagram"].map((option) => (
              <button
                key={option}
                onClick={() => { setSurvey1(option); setSurvey1Other(""); }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  survey1 === option
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
                }`}
              >
                {option}
              </button>
            ))}
            <button
              onClick={() => setSurvey1("other")}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                survey1 === "other"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
              }`}
            >
              Other
            </button>
            {survey1 === "other" && (
              <Input
                placeholder="Tell us more..."
                value={survey1Other}
                onChange={(e) => setSurvey1Other(e.target.value)}
                className="bg-secondary/50 border-border mt-2"
                autoFocus
              />
            )}
          </div>
          <Button
            variant="hero"
            size="lg"
            className="w-full mt-6"
            disabled={!survey1 || (survey1 === "other" && !survey1Other.trim())}
            onClick={() => setStep("survey2")}
          >
            Next
          </Button>
        </div>
      </div>
    );
  }

  // Survey 2: Why are you using NazAI?
  if (step === "survey2") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-float opacity-60" />
          <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-glow-secondary/20 rounded-full blur-3xl animate-float-delayed opacity-40" />
        </div>
        <div className="relative z-10 p-8 rounded-3xl glass border-glow max-w-md w-full mx-6">
          <div className="mb-6"><Logo size="lg" linkTo="/" /></div>
          <h2 className="text-2xl font-bold mb-2">Why are you using NazAI?</h2>
          <p className="text-muted-foreground mb-6 text-sm">Help us understand your goals.</p>
          <div className="space-y-3">
            {["For business", "Testing out", "For personal usage"].map((option) => (
              <button
                key={option}
                onClick={() => { setSurvey2(option); setSurvey2Other(""); }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  survey2 === option
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
                }`}
              >
                {option}
              </button>
            ))}
            <button
              onClick={() => setSurvey2("other")}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                survey2 === "other"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
              }`}
            >
              Other
            </button>
            {survey2 === "other" && (
              <Input
                placeholder="Tell us more..."
                value={survey2Other}
                onChange={(e) => setSurvey2Other(e.target.value)}
                className="bg-secondary/50 border-border mt-2"
                autoFocus
              />
            )}
          </div>
          <Button
            variant="hero"
            size="lg"
            className="w-full mt-6"
            disabled={!survey2 || (survey2 === "other" && !survey2Other.trim())}
            onClick={handleSurveyComplete}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // Welcome screen with credits
  if (step === "welcome") {
    return (
      <div className={`min-h-screen bg-background flex items-center justify-center relative overflow-hidden`}>
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-float opacity-60" />
          <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-glow-secondary/20 rounded-full blur-3xl animate-float-delayed opacity-40" />
        </div>
        {/* Screen flash overlay */}
        {transitioning && (
          <div className="absolute inset-0 z-50 bg-primary/20 animate-screen-flash pointer-events-none" />
        )}
        {/* Particle burst effect */}
        {transitioning && (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
            <div className="w-32 h-32 rounded-full border-2 border-primary/40 animate-particles-burst" />
            <div className="absolute w-20 h-20 rounded-full border border-primary/30 animate-particles-burst" style={{ animationDelay: "0.1s" }} />
            <div className="absolute w-48 h-48 rounded-full border border-primary/20 animate-particles-burst" style={{ animationDelay: "0.2s" }} />
          </div>
        )}
        <div className={`relative z-10 text-center p-8 rounded-3xl glass border-glow max-w-md w-full mx-6 ${transitioning ? 'animate-portal-exit' : 'animate-scale-in'}`}>
          <div className="mb-6"><Logo size="lg" linkTo="/" /></div>
          <div className="flex items-center justify-center gap-2 mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-3">Welcome! "&#x1F389;"</h1>
          <p className="text-muted-foreground mb-6">Your account has been created successfully.</p>
          <div className="inline-flex items-center gap-3 px-6 py-4 rounded-2xl glass border border-primary/30 mb-6">
            <Coins className="w-8 h-8 text-primary" />
            <div className="text-left">
              <p className="text-2xl font-bold text-primary">10</p>
              <p className="text-sm text-muted-foreground">Free Credits</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-4">Each credit lets you generate or edit one website.</p>
          <p className="text-xs text-muted-foreground animate-pulse">
            {transitioning ? "Launching NazAI..." : "Redirecting to dashboard..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-float opacity-60" />
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-glow-secondary/20 rounded-full blur-3xl animate-float-delayed opacity-40" />
      </div>

      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-md mx-auto">
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          <div className="p-8 rounded-3xl glass border-glow">
            <div className="mb-6"><Logo size="lg" linkTo="/" /></div>
            <h1 className="text-2xl font-bold mb-2">Start for Free</h1>
            <p className="text-muted-foreground mb-6">Create your account and get <span className="text-primary font-semibold">10 free credits</span> to generate websites.</p>

            {/* Social Login Buttons */}
            <div className="space-y-3 mb-6">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full bg-secondary/50 border-border hover:bg-secondary/80"
                onClick={() => handleSocialSignup("google")}
                disabled={!!socialLoading}
              >
                {socialLoading === "google" ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                )}
                Continue with Google
              </Button>

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full bg-secondary/50 border-border hover:bg-secondary/80"
                onClick={() => handleSocialSignup("apple")}
                disabled={!!socialLoading}
              >
                {socialLoading === "apple" ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                  </svg>
                )}
                Continue with Apple
              </Button>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-card/60 text-muted-foreground">or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" type="text" placeholder="John Doe" required
                  value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-secondary/50 border-border" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="john@example.com" required
                  value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="bg-secondary/50 border-border" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" required minLength={6}
                  value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="bg-secondary/50 border-border" />
              </div>
              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {loading ? "Creating account..." : "Create Account"}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-6">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:underline">Log in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signup;
