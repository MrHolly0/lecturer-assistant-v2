import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { components } from "./api/schema";
import { getCurrentUser, loginWithMax, logout, refreshAuth } from "./api/auth-api";
import { ApiError } from "./api/http";
import { clearStoredAuth, getStoredAuth } from "./auth";
import { useMaxBridge } from "./max/context";

type UserProfile = components["schemas"]["UserProfile"];

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  maxAuthError: string | null;
  retryMaxAuth: () => void;
  setUser: (user: UserProfile | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  maxAuthError: null,
  retryMaxAuth: () => {},
  setUser: () => {},
  signOut: async () => {}
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { initData, isMax } = useMaxBridge();
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxAuthError, setMaxAuthError] = useState<string | null>(null);
  const [maxAuthAttempt, setMaxAuthAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const expireAuth = () => {
      setUserState(null);
      toast.error("Сессия истекла. Войдите снова.", { id: "auth-expired" });
    };
    window.addEventListener("auth:expired", expireAuth);

    setLoading(true);
    setMaxAuthError(null);
    if (isMax) {
      if (!initData) {
        setMaxAuthError(
          "MAX не передал данные для входа. Закройте и снова откройте мини-приложение."
        );
        setLoading(false);
        return () => window.removeEventListener("auth:expired", expireAuth);
      }

      loginWithMax(initData)
        .then(({ user: maxUser }) => {
          if (active) setUserState(maxUser);
        })
        .catch((error: unknown) => {
          if (active) setMaxAuthError(maxAuthErrorMessage(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
        window.removeEventListener("auth:expired", expireAuth);
      };
    }

    if (!getStoredAuth()) {
      refreshAuth()
        .then((auth) => {
          if (active) setUserState(auth?.user ?? null);
        })
        .catch(() => clearStoredAuth())
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
        window.removeEventListener("auth:expired", expireAuth);
      };
    }
    getCurrentUser()
      .then((currentUser) => {
        if (active) setUserState(currentUser);
      })
      .catch(() => clearStoredAuth())
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.removeEventListener("auth:expired", expireAuth);
    };
  }, [initData, isMax, maxAuthAttempt]);

  function retryMaxAuth() {
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  async function signOut() {
    await logout();
    clearStoredAuth();
    setUserState(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, maxAuthError, retryMaxAuth, setUser: setUserState, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

function maxAuthErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Срок действия входа MAX истёк. Закройте и снова откройте мини-приложение.";
    }
    if (error.status === 403) return "Эта учётная запись отключена администратором.";
    if (error.status === 503) return "Вход через MAX временно недоступен. Попробуйте позже.";
  }
  return "Не удалось войти через MAX. Проверьте подключение и попробуйте ещё раз.";
}
