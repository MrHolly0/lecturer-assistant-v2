import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { components } from "./api/schema";
import {
  getCurrentUser,
  login,
  loginWithMax,
  logout,
  refreshAuth,
  registerByInvitation
} from "./api/auth-api";
import { createMaxLinkCode } from "./api/max-identity-api";
import { ApiError } from "./api/http";
import { clearStoredAuth, getStoredAuth } from "./auth";
import { useMaxBridge } from "./max/context";
import { normalizeLinkCode, readMaxLinkCode } from "./max/deepLink";

type UserProfile = components["schemas"]["UserProfile"];
const MAX_SIGNED_OUT_KEY = "la_max_signed_out";

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  maxAuthError: string | null;
  maxSignedOut: boolean;
  maxLinkRequired: boolean;
  maxCredentialsRequired: boolean;
  loginAndLinkMax: (email: string, password: string) => Promise<void>;
  registerAndLinkMax: (
    name: string,
    email: string,
    password: string,
    invitationCode: string
  ) => Promise<void>;
  submitMaxLinkCode: (code: string) => void;
  continueMaxAuth: () => void;
  retryMaxAuth: () => void;
  resumeMaxAuth: () => void;
  setUser: (user: UserProfile | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  maxAuthError: null,
  maxSignedOut: false,
  maxLinkRequired: false,
  maxCredentialsRequired: false,
  loginAndLinkMax: async () => {},
  registerAndLinkMax: async () => {},
  submitMaxLinkCode: () => {},
  continueMaxAuth: () => {},
  retryMaxAuth: () => {},
  resumeMaxAuth: () => {},
  setUser: () => {},
  signOut: async () => {}
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { initData, isMax, startParam } = useMaxBridge();
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxAuthError, setMaxAuthError] = useState<string | null>(null);
  const [maxSignedOut, setMaxSignedOut] = useState(() => readMaxSignedOut());
  const [maxLinkRequired, setMaxLinkRequired] = useState(false);
  const [maxCredentialsRequired, setMaxCredentialsRequired] = useState(false);
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

    if (isMax && maxSignedOut) {
      setLoading(false);
      setMaxAuthError(null);
      return () => window.removeEventListener("auth:expired", expireAuth);
    }

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
      const waitsForPrefilledCode = Boolean(startLinkCode && requestedMaxLinkCode === null);
      if (waitsForPrefilledCode) {
        setMaxLinkRequired(true);
        setMaxCredentialsRequired(false);
        setLoading(false);
        return () => window.removeEventListener("auth:expired", expireAuth);
      }

      if (!linkCode && !opensLecture && !allowMaxAuthWithoutCode) {
        loginWithMax(initData, undefined, startParam ?? undefined, true)
          .then(({ user: maxUser }) => {
            if (!active) return;
            setUserState(maxUser);
            setMaxLinkRequired(false);
            setMaxCredentialsRequired(false);
          })
          .catch((error: unknown) => {
            if (!active) return;
            if (error instanceof ApiError && error.status === 404) {
              setMaxCredentialsRequired(true);
            } else {
              setMaxAuthError(maxAuthErrorMessage(error, false));
            }
          })
          .finally(() => {
            if (active) setLoading(false);
          });
        return () => {
          active = false;
          window.removeEventListener("auth:expired", expireAuth);
        };
      }

      setMaxLinkRequired(false);
      setMaxCredentialsRequired(false);
      loginWithMax(initData, linkCode ?? undefined, startParam ?? undefined)
        .then(({ user: maxUser }) => {
          if (!active) return;
          setUserState(maxUser);
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
  }, [
    allowMaxAuthWithoutCode,
    initData,
    isMax,
    maxAuthAttempt,
    maxSignedOut,
    requestedMaxLinkCode,
    startParam
  ]);

  function retryMaxAuth() {
    setLoading(true);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  function resumeMaxAuth() {
    try {
      sessionStorage.removeItem(MAX_SIGNED_OUT_KEY);
    } catch {
      // The current WebView can still resume even if storage is unavailable.
    }
    setLoading(true);
    setMaxSignedOut(false);
  }

  function submitMaxLinkCode(code: string) {
    setMaxAuthError(null);
    setLoading(true);
    setRequestedMaxLinkCode(normalizeLinkCode(code));
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  function continueMaxAuth() {
    setMaxAuthError(null);
    setMaxCredentialsRequired(false);
    setLoading(true);
    setRequestedMaxLinkCode("");
    setAllowMaxAuthWithoutCode(true);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  async function linkAuthenticatedAccount(authenticate: () => Promise<{ user: UserProfile }>) {
    if (!initData)
      throw new Error("MAX не передал данные для входа. Откройте мини-приложение снова.");
    try {
      const { user: account } = await authenticate();
      if (account.role === "STUDENT") {
        throw new Error("Для студента вход по паролю не нужен. Используйте вход через MAX.");
      }
      const { code } = await createMaxLinkCode();
      const { user: maxUser } = await loginWithMax(initData, code);
      if (maxUser.id !== account.id) {
        throw new Error(
          "Этот профиль MAX уже привязан к другой учётной записи. Обратитесь к администратору."
        );
      }
      setUserState(maxUser);
      setMaxCredentialsRequired(false);
      setMaxAuthError(null);
    } catch (error) {
      clearStoredAuth();
      throw error;
    }
  }

  function loginAndLinkMax(email: string, password: string) {
    return linkAuthenticatedAccount(() => login(email, password));
  }

  function registerAndLinkMax(
    name: string,
    email: string,
    password: string,
    invitationCode: string
  ) {
    let registered = false;
    return linkAuthenticatedAccount(async () => {
      const auth = await registerByInvitation(name, email, password, invitationCode);
      registered = true;
      return auth;
    }).catch((error: unknown) => {
      if (registered) {
        throw new Error(
          "Аккаунт создан, но MAX не подключился. Переключитесь на вход и попробуйте с новым паролем."
        );
      }
      throw error;
    });
  }

  async function signOut() {
    await logout();
    clearStoredAuth();
    if (isMax) {
      try {
        sessionStorage.setItem(MAX_SIGNED_OUT_KEY, "true");
      } catch {
        // In-memory state still keeps this WebView signed out.
      }
      setMaxSignedOut(true);
      setMaxAuthError(null);
    }
    setUserState(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        maxAuthError,
        maxSignedOut,
        maxLinkRequired,
        maxCredentialsRequired,
        loginAndLinkMax,
        registerAndLinkMax,
        submitMaxLinkCode,
        continueMaxAuth,
        retryMaxAuth,
        resumeMaxAuth,
        setUser: setUserState,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function readMaxSignedOut(): boolean {
  try {
    return sessionStorage.getItem(MAX_SIGNED_OUT_KEY) === "true";
  } catch {
    return false;
  }
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
