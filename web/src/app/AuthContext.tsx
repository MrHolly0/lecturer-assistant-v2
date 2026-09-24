import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { components } from "./api/schema";
import { getCurrentUser, loginWithMax, logout, refreshAuth } from "./api/auth-api";
import { ApiError } from "./api/http";
import { clearStoredAuth, getStoredAuth } from "./auth";
import { useMaxBridge } from "./max/context";
import { normalizeLinkCode, readMaxLinkCode } from "./max/deepLink";

type UserProfile = components["schemas"]["UserProfile"];

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  maxAuthError: string | null;
  maxLinkRequired: boolean;
  submitMaxLinkCode: (code: string) => void;
  continueMaxAuth: () => void;
  retryMaxAuth: () => void;
  setUser: (user: UserProfile | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  maxAuthError: null,
  maxLinkRequired: false,
  submitMaxLinkCode: () => {},
  continueMaxAuth: () => {},
  retryMaxAuth: () => {},
  setUser: () => {},
  signOut: async () => {}
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { initData, isMax, startParam } = useMaxBridge();
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxAuthError, setMaxAuthError] = useState<string | null>(null);
  const [maxLinkRequired, setMaxLinkRequired] = useState(false);
  const [requestedMaxLinkCode, setRequestedMaxLinkCode] = useState<string | null>(null);
  const [allowMaxAuthWithoutCode, setAllowMaxAuthWithoutCode] = useState(false);
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

      const startLinkCode = readMaxLinkCode(startParam);
      const linkCode = requestedMaxLinkCode === null ? null : requestedMaxLinkCode || null;
      const opensLecture = Boolean(startParam && !startLinkCode);
      const knownLinkedAccount = localStorage.getItem("la_max_account_linked") === "true";
      const waitsForPrefilledCode = Boolean(startLinkCode && requestedMaxLinkCode === null);
      if (
        waitsForPrefilledCode ||
        (!linkCode && !opensLecture && !knownLinkedAccount && !allowMaxAuthWithoutCode)
      ) {
        setMaxLinkRequired(true);
        setLoading(false);
        return () => window.removeEventListener("auth:expired", expireAuth);
      }

      setMaxLinkRequired(false);
      loginWithMax(initData, linkCode ?? undefined)
        .then(({ user: maxUser }) => {
          if (!active) return;
          setUserState(maxUser);
          if (linkCode || maxUser.role !== "STUDENT") {
            localStorage.setItem("la_max_account_linked", "true");
          }
        })
        .catch((error: unknown) => {
          if (!active) return;
          setMaxAuthError(maxAuthErrorMessage(error, Boolean(linkCode)));
          if (linkCode) setMaxLinkRequired(true);
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
  }, [allowMaxAuthWithoutCode, initData, isMax, maxAuthAttempt, requestedMaxLinkCode, startParam]);

  function retryMaxAuth() {
    setLoading(true);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  function submitMaxLinkCode(code: string) {
    setMaxAuthError(null);
    setLoading(true);
    setRequestedMaxLinkCode(normalizeLinkCode(code));
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  function continueMaxAuth() {
    setMaxAuthError(null);
    setLoading(true);
    setRequestedMaxLinkCode("");
    setAllowMaxAuthWithoutCode(true);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  async function signOut() {
    await logout();
    clearStoredAuth();
    setUserState(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        maxAuthError,
        maxLinkRequired,
        submitMaxLinkCode,
        continueMaxAuth,
        retryMaxAuth,
        setUser: setUserState,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

function maxAuthErrorMessage(error: unknown, linking: boolean): string {
  if (error instanceof ApiError) {
    if (linking && error.status === 400) return "Код неверный или истёк.";
    if (linking && error.status === 409) return "Код уже использован.";
    if (error.status === 401) {
      return "Срок действия входа MAX истёк. Закройте и снова откройте мини-приложение.";
    }
    if (error.status === 403) return "Эта учётная запись отключена администратором.";
    if (error.status === 503) return "Вход через MAX временно недоступен. Попробуйте позже.";
  }
  return "Не удалось войти через MAX. Проверьте подключение и попробуйте ещё раз.";
}
