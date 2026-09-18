import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { components } from "./api/schema";
import { getCurrentUser, logout, refreshAuth } from "./api/auth-api";
import { clearStoredAuth, getStoredAuth } from "./auth";

type UserProfile = components["schemas"]["UserProfile"];

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  setUser: (user: UserProfile | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  setUser: () => {},
  signOut: async () => {}
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const expireAuth = () => {
      setUserState(null);
      toast.error("Сессия истекла. Войдите снова.", { id: "auth-expired" });
    };
    window.addEventListener("auth:expired", expireAuth);
    if (!getStoredAuth()) {
      refreshAuth()
        .then((auth) => setUserState(auth?.user ?? null))
        .catch(() => clearStoredAuth())
        .finally(() => setLoading(false));
      return () => window.removeEventListener("auth:expired", expireAuth);
    }
    getCurrentUser()
      .then((u) => setUserState(u))
      .catch(() => clearStoredAuth())
      .finally(() => setLoading(false));
    return () => window.removeEventListener("auth:expired", expireAuth);
  }, []);

  async function signOut() {
    await logout();
    clearStoredAuth();
    setUserState(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, setUser: setUserState, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
