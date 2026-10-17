import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { components } from "./api/schema";
import {
  confirmMaxLink as confirmMaxLinkRequest,
  getCurrentUser,
  loginWithMax,
  logout,
  previewMaxLink,
  refreshAuth,
  registerByInvitation
} from "./api/auth-api";
import type { MaxLinkPreview } from "./api/auth-api";
import { ApiError } from "./api/http";
import { refreshAuthSession } from "./api/refresh";
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
  maxLinkPreview: MaxLinkPreview | null;
  maxLinkPreviewPending: boolean;
  maxLinkCodeInput: string;
  maxLinkRegistrationPending: boolean;
  loginAndLinkMax: (email: string, password: string) => Promise<void>;
  registerAndLinkMax: (
    name: string,
    email: string,
    password: string,
    invitationCode: string
  ) => Promise<void>;
  submitMaxLinkCode: (code: string) => void;
  confirmMaxLink: () => Promise<void>;
  cancelMaxLinkPreview: () => void;
  continueMaxAuth: () => void;
  retryMaxAuth: () => void;
  resumeMaxAuth: () => void;
  chooseMaxLinkCode: () => void;
  chooseMaxCredentials: () => void;
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
  maxLinkPreview: null,
  maxLinkPreviewPending: false,
  maxLinkCodeInput: "",
  maxLinkRegistrationPending: false,
  loginAndLinkMax: async () => {},
  registerAndLinkMax: async () => {},
  submitMaxLinkCode: () => {},
  confirmMaxLink: async () => {},
  cancelMaxLinkPreview: () => {},
  continueMaxAuth: () => {},
  retryMaxAuth: () => {},
  resumeMaxAuth: () => {},
  chooseMaxLinkCode: () => {},
  chooseMaxCredentials: () => {},
  setUser: () => {},
  signOut: async () => {}
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { initData, isMax, startParam } = useMaxBridge();
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxAuthError, setMaxAuthError] = useState<string | null>(null);
  const [maxSignedOut, setMaxSignedOut] = useState(() => readMaxSignedOut());
  const [maxLinkRequired, setMaxLinkRequired] = useState(false);
  const [maxCredentialsRequired, setMaxCredentialsRequired] = useState(false);
  const [maxLinkPreview, setMaxLinkPreview] = useState<MaxLinkPreview | null>(null);
  const [maxLinkPreviewPending, setMaxLinkPreviewPending] = useState(false);
  const [pendingRegistration, setPendingRegistration] = useState(false);
  const [requestedMaxLinkCode, setRequestedMaxLinkCode] = useState<string | null>(null);
  const [maxLinkCodeDraft, setMaxLinkCodeDraft] = useState("");
  const [allowMaxAuthWithoutCode, setAllowMaxAuthWithoutCode] = useState(false);
  const [maxAuthAttempt, setMaxAuthAttempt] = useState(0);
  const [maxAuthChoice, setMaxAuthChoice] = useState<"automatic" | "code" | "credentials">(
    "automatic"
  );

  useEffect(() => {
    let active = true;
    const expireAuth = () => {
      if (isMax && initData && !maxSignedOut) {
        setLoading(true);
        void loginWithMax(initData, undefined, undefined, true)
          .then(({ user: restored }) => {
            if (active) setUserState(restored);
          })
          .catch(() => {
            if (!active) return;
            setUserState(null);
            setMaxAuthError("Вход устарел. Откройте мини-приложение снова или войдите по коду.");
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      } else {
        setUserState(null);
        toast.error("Сессия истекла. Войдите снова.", { id: "auth-expired" });
      }
    };
    const updateAuth = (event: Event) => {
      const refreshed = (event as CustomEvent<{ user: UserProfile }>).detail;
      if (!maxSignedOut && refreshed?.user) setUserState(refreshed.user);
    };
    window.addEventListener("auth:expired", expireAuth);
    window.addEventListener("auth:refreshed", updateAuth);
    const cleanup = () => {
      active = false;
      window.removeEventListener("auth:expired", expireAuth);
      window.removeEventListener("auth:refreshed", updateAuth);
    };

    if (isMax && maxSignedOut) {
      setLoading(false);
      setMaxAuthError(null);
      return cleanup;
    }

    setLoading(true);
    setMaxAuthError(null);
    if (isMax) {
      if (!initData) {
        setMaxAuthError(
          "MAX не передал данные для входа. Закройте и снова откройте мини-приложение."
        );
        setLoading(false);
        return cleanup;
      }

      if (maxAuthChoice === "code" && requestedMaxLinkCode === null) {
        setMaxLinkRequired(true);
        setMaxCredentialsRequired(false);
        setLoading(false);
        return cleanup;
      }
      if (maxAuthChoice === "credentials") {
        setMaxLinkRequired(false);
        setMaxCredentialsRequired(true);
        setLoading(false);
        return cleanup;
      }

      const startLinkCode = readMaxLinkCode(startParam);
      const linkCode = requestedMaxLinkCode === null ? null : requestedMaxLinkCode || null;
      const opensLecture = Boolean(startParam && !startLinkCode);
      const waitsForPrefilledCode = Boolean(startLinkCode && requestedMaxLinkCode === null);
      if (waitsForPrefilledCode) {
        setMaxLinkRequired(true);
        setMaxCredentialsRequired(false);
        setLoading(false);
        return cleanup;
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
        return cleanup;
      }

      setMaxLinkRequired(false);
      setMaxCredentialsRequired(false);
      if (linkCode) {
        setMaxLinkPreview(null);
        setMaxLinkPreviewPending(true);
        previewMaxLink({ initData, linkCode })
          .then((preview) => {
            if (!active) return;
            setMaxLinkPreview(preview);
            setMaxAuthError(null);
          })
          .catch((error: unknown) => {
            if (!active) return;
            setMaxAuthError(maxAuthErrorMessage(error, true));
            setMaxLinkRequired(true);
          })
          .finally(() => {
            if (active) {
              setMaxLinkPreviewPending(false);
              setLoading(false);
            }
          });
        return cleanup;
      }

      loginWithMax(initData, undefined, startParam ?? undefined)
        .then(({ user: maxUser }) => {
          if (!active) return;
          setUserState(maxUser);
        })
        .catch((error: unknown) => {
          if (!active) return;
          setMaxAuthError(maxAuthErrorMessage(error, false));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return cleanup;
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
      return cleanup;
    }
    getCurrentUser()
      .then((currentUser) => {
        if (active) setUserState(currentUser);
      })
      .catch(() => clearStoredAuth())
      .finally(() => {
        if (active) setLoading(false);
      });
    return cleanup;
  }, [
    allowMaxAuthWithoutCode,
    initData,
    isMax,
    maxAuthAttempt,
    maxAuthChoice,
    maxSignedOut,
    requestedMaxLinkCode,
    startParam
  ]);

  const authenticatedUserId = user?.id;
  useEffect(() => {
    if (!authenticatedUserId || maxSignedOut) return;
    let lastCheck = Date.now();
    let checking = false;
    const revalidate = async () => {
      if (document.visibilityState !== "visible" || checking || Date.now() - lastCheck < 60_000)
        return;
      lastCheck = Date.now();
      checking = true;
      try {
        const refreshed = await refreshAuthSession();
        if (refreshed) {
          setUserState(refreshed.user);
          await queryClient.invalidateQueries({ type: "active" });
        } else if (isMax && initData) {
          const restored = await loginWithMax(initData, undefined, undefined, true);
          setUserState(restored.user);
          await queryClient.invalidateQueries({ type: "active" });
        }
      } catch {
        // The next authenticated request shows the recovery screen if credentials expired.
      } finally {
        checking = false;
      }
    };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    const interval = window.setInterval(revalidate, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
      window.clearInterval(interval);
    };
  }, [authenticatedUserId, initData, isMax, maxSignedOut, queryClient]);

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
    setMaxAuthChoice("automatic");
    setRequestedMaxLinkCode(null);
    setMaxLinkCodeDraft("");
    setAllowMaxAuthWithoutCode(false);
  }

  function chooseMaxLinkCode() {
    try {
      sessionStorage.removeItem(MAX_SIGNED_OUT_KEY);
    } catch {
      // In-memory state still allows another authentication method.
    }
    setMaxAuthError(null);
    setMaxLinkCodeDraft("");
    setRequestedMaxLinkCode(null);
    setMaxAuthChoice("code");
    setMaxLinkRequired(true);
    setMaxCredentialsRequired(false);
    setMaxSignedOut(false);
  }

  function chooseMaxCredentials() {
    try {
      sessionStorage.removeItem(MAX_SIGNED_OUT_KEY);
    } catch {
      // In-memory state still allows another authentication method.
    }
    setMaxAuthError(null);
    setMaxLinkCodeDraft("");
    setMaxAuthChoice("credentials");
    setMaxLinkRequired(false);
    setMaxCredentialsRequired(true);
    setMaxSignedOut(false);
  }

  function submitMaxLinkCode(code: string) {
    setMaxAuthError(null);
    setLoading(true);
    const normalizedCode = normalizeLinkCode(code);
    setMaxLinkCodeDraft(normalizedCode);
    setRequestedMaxLinkCode(normalizedCode);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  async function confirmPendingMaxLink() {
    if (!initData || !maxLinkPreview) return;
    setMaxLinkPreviewPending(true);
    setMaxAuthError(null);
    try {
      const { user: linkedUser } = await confirmMaxLinkRequest(
        initData,
        maxLinkPreview.confirmationToken
      );
      queryClient.clear();
      setUserState(linkedUser);
      setMaxLinkPreview(null);
      setMaxLinkCodeDraft("");
      setPendingRegistration(false);
      setMaxLinkRequired(false);
      setMaxCredentialsRequired(false);
      setMaxSignedOut(false);
      setMaxAuthError(null);
      try {
        sessionStorage.removeItem(MAX_SIGNED_OUT_KEY);
      } catch {
        // In-memory auth state is sufficient for this WebView.
      }
    } catch (error) {
      clearStoredAuth();
      setMaxLinkPreview(null);
      setMaxAuthError(maxLinkConfirmErrorMessage(error));
      if (maxAuthChoice === "code") {
        setMaxLinkRequired(true);
        setMaxCredentialsRequired(false);
      } else {
        setMaxCredentialsRequired(true);
        setMaxLinkRequired(false);
      }
    } finally {
      setMaxLinkPreviewPending(false);
    }
  }

  function cancelPendingMaxLink() {
    setMaxLinkPreview(null);
    clearStoredAuth();
    setMaxLinkPreviewPending(false);
    setMaxAuthError(
      pendingRegistration
        ? "Учётная запись создана, но MAX не подключён. Можно войти по email и паролю позже."
        : null
    );
    setPendingRegistration(false);
    if (maxAuthChoice === "code") {
      setRequestedMaxLinkCode(null);
      setMaxLinkRequired(true);
      setMaxCredentialsRequired(false);
    } else {
      setMaxCredentialsRequired(true);
      setMaxLinkRequired(false);
    }
  }

  function continueMaxAuth() {
    setMaxAuthError(null);
    setMaxCredentialsRequired(false);
    setLoading(true);
    setMaxAuthChoice("automatic");
    setRequestedMaxLinkCode("");
    setMaxLinkCodeDraft("");
    setAllowMaxAuthWithoutCode(true);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  async function loginAndLinkMax(email: string, password: string) {
    if (!initData)
      throw new Error("MAX не передал данные для входа. Откройте мини-приложение снова.");
    setMaxAuthError(null);
    const preview = await previewMaxLink({ initData, email, password });
    setMaxLinkPreview(preview);
    setPendingRegistration(false);
    setMaxCredentialsRequired(false);
    setMaxLinkRequired(false);
    setMaxAuthError(null);
  }

  async function registerAndLinkMax(
    name: string,
    email: string,
    password: string,
    invitationCode: string
  ) {
    if (!initData)
      throw new Error("MAX не передал данные для входа. Откройте мини-приложение снова.");
    setMaxAuthError(null);
    setPendingRegistration(false);
    await registerByInvitation(name, email, password, invitationCode);
    clearStoredAuth();
    setMaxAuthError(null);
    try {
      const preview = await previewMaxLink({ initData, email, password });
      setMaxLinkPreview(preview);
      setPendingRegistration(true);
      setMaxCredentialsRequired(false);
      setMaxLinkRequired(false);
    } catch (error) {
      clearStoredAuth();
      setPendingRegistration(false);
      setMaxAuthError(
        `Учётная запись создана, но не подключена к MAX. ${maxAuthErrorMessage(error, false)}`
      );
      throw error;
    }
  }

  async function signOut() {
    await logout();
    clearStoredAuth();
    queryClient.clear();
    if (isMax) {
      try {
        sessionStorage.setItem(MAX_SIGNED_OUT_KEY, "true");
      } catch {
        // In-memory state still keeps this WebView signed out.
      }
      setMaxSignedOut(true);
      setMaxAuthError(null);
      setMaxLinkPreview(null);
      setPendingRegistration(false);
      setMaxLinkRequired(false);
      setMaxCredentialsRequired(false);
      setMaxAuthChoice("automatic");
      setRequestedMaxLinkCode(null);
      setMaxLinkCodeDraft("");
      setAllowMaxAuthWithoutCode(false);
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
        maxLinkPreview,
        maxLinkPreviewPending,
        maxLinkCodeInput: maxLinkCodeDraft,
        maxLinkRegistrationPending: pendingRegistration,
        loginAndLinkMax,
        registerAndLinkMax,
        submitMaxLinkCode,
        confirmMaxLink: confirmPendingMaxLink,
        cancelMaxLinkPreview: cancelPendingMaxLink,
        continueMaxAuth,
        retryMaxAuth,
        resumeMaxAuth,
        chooseMaxLinkCode,
        chooseMaxCredentials,
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
    if (linking && error.status === 409)
      return "Код уже использован или выбранный аккаунт привязан к другому MAX.";
    if (error.status === 401) {
      return "Срок действия входа MAX истёк. Закройте и снова откройте мини-приложение.";
    }
    if (error.status === 403) return "Эта учётная запись отключена администратором.";
    if (error.status === 503) return "Вход через MAX временно недоступен. Попробуйте позже.";
  }
  return "Не удалось войти через MAX. Проверьте подключение и попробуйте ещё раз.";
}

function maxLinkConfirmErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400 || error.status === 409) {
      return "Проверка истекла или данные аккаунтов изменились. Проверьте аккаунт ещё раз перед подтверждением.";
    }
    if (error.status === 401) {
      return "Срок действия входа MAX истёк. Закройте и снова откройте мини-приложение.";
    }
    if (error.status === 403) return "Эта учётная запись отключена администратором.";
    if (error.status === 503) return "Вход через MAX временно недоступен. Попробуйте позже.";
  }
  return "Не удалось подтвердить подключение MAX. Проверьте аккаунт ещё раз.";
}
