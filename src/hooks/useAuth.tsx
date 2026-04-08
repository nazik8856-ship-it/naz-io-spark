import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<Session | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // 1. Initialize to true so the app waits for Supabase before showing content
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    // 2. Immediate session check on mount
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (isActive) {
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        // CRITICAL: Unblocks the app after the first check
        setLoading(false);
      }
    });

    // 3. Listen for auth changes (Login, Logout, Token Refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (isActive) {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { session: refreshedSession },
      } = await supabase.auth.getSession();
      setSession(refreshedSession);
      setUser(refreshedSession?.user ?? null);
      return refreshedSession;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      setLoading(true);
      await supabase.auth.signOut();
      setSession(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signOut,
      refreshSession,
    }),
    [user, session, loading, signOut, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
