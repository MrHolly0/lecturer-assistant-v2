import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { components } from "./api/schema";
import {
  confirmMaxLink as confirmMaxLinkRequest,
  getCurrentUser,
  login as loginWithCredentials,
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
const MAX_PASSWORD_SESSION_KEY = "la_max_password_session";

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  maxAuthError: string | null;
  maxSignedOut: boolean;
  maxLinkRequired: boolean;
  maxCredentialsRequired: boolean;
  maxLoginView: "entry" | "teacher" | null;
  maxLinkPreview: MaxLinkPreview | null;
  maxLinkPreviewPending: boolean;
  maxLinkCodeInput: string;
  maxLinkRegistrationPending: boolean;
  loginWithPassword: (email: string, password: string) => Promise<void>;
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
  chooseMaxEntry: () => void;
  chooseMaxTeacher: () => void;
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
  maxLoginView: null,
  maxLinkPreview: null,
  maxLinkPreviewPending: false,
  maxLinkCodeInput: "",
  maxLinkRegistrationPending: false,
  loginWithPassword: async () => {},
  registerAndLinkMax: async () => {},
  submitMaxLinkCode: () => {},
  confirmMaxLink: async () => {},
  cancelMaxLinkPreview: () => {},
  continueMaxAuth: () => {},
  retryMaxAuth: () => {},
  resumeMaxAuth: () => {},
  chooseMaxLinkCode: () => {},
  chooseMaxCredentials: () => {},
  chooseMaxEntry: () => {},
  chooseMaxTeacher: () => {},
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
  const [maxEntryChosen, setMaxEntryChosen] = useState(false);
  const [maxAuthChoice, setMaxAuthChoice] = useState<
    "entry" | "teacher" | "session" | "password" | "automatic" | "code" | "credentials"
  >(() => (getStoredAuth() ? (readMaxPasswordSession() ? "password" : "session") : "entry"));

  useEffect(() => {
    let active = true;
    const expireAuth = () => {
      if (isMax && initData && !maxSignedOut && maxAuthChoice === "automatic") {
        setLoading(true);
        void loginWithMax(initData, undefined, undefined, true)
          .then(({ user: restored }) => {
            if (active) setUserState(restored);
          })
          .catch(() => {
            if (!active) return;
            setUserState(null);
            setMaxAuthError(
              "Вход устарел. Откройте мини-приложение снова или войдите по почте и паролю."
            );
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      } else {
        setUserState(null);
        if (isMax) {
          setMaxAuthChoice("teacher");
          setMaxAuthError("Вход устарел. Выберите способ входа снова.");
          setLoading(false);
        }
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
    if (isMax) {
      const startLinkCode =
        !maxEntryChosen && (maxAuthChoice === "entry" || maxAuthChoice === "session")
          ? readMaxLinkCode(startParam)
          : null;
      const opensLecture =
        !maxEntryChosen && maxAuthChoice === "entry" && Boolean(startParam && !startLinkCode);
      if (
        maxAuthChoice === "teacher" ||
        (maxAuthChoice === "entry" && !opensLecture && !startLinkCode)
      ) {
        setLoading(false);
        return cleanup;
      }
      if ((maxAuthChoice === "session" && !startLinkCode) || maxAuthChoice === "password") {
        getCurrentUser()
          .then((currentUser) => {
            if (active) setUserState(currentUser);
          })
          .catch(() => {
            if (!active) return;
            clearStoredAuth();
            setUserState(null);
            setMaxAuthChoice("entry");
          })
          .finally(() => {
            if (active) setLoading(false);
          });
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
      if (!initData) {
        setMaxAuthError(
          "MAX не передал данные для входа. Откройте мини-приложение снова или войдите по почте и паролю."
        );
        setLoading(false);
        return cleanup;
      }
      setMaxAuthError(null);
      const linkCode = requestedMaxLinkCode === null ? null : requestedMaxLinkCode || null;
      const waitsForPrefilledCode = Boolean(startLinkCode && requestedMaxLinkCode === null);
      if (waitsForPrefilledCode) {
        setMaxLinkRequired(true);
        setMaxCredentialsRequired(false);
        setLoading(false);
        return cleanup;
      }

      if (!linkCode && !opensLecture && !allowMaxAuthWithoutCode) {
        loginWithMax(initData, undefined, startParam ?? undefined, true)
          .then(async ({ user: maxUser }) => {
            if (!active) return;
            if (maxUser.role === "STUDENT") {
              await logout();
              clearStoredAuth();
              if (!active) return;
              setUserState(null);
              setMaxAuthChoice("teacher");
              setMaxAuthError(
                "К этому MAX подключён аккаунт студента. Войдите преподавателем по почте и паролю."
              );
              return;
            }
            setUserState(maxUser);
            setMaxLinkRequired(false);
            setMaxCredentialsRequired(false);
          })
          .catch((error: unknown) => {
            if (!active) return;
            if (error instanceof ApiError && error.status === 404) {
              setMaxAuthChoice("teacher");
              setMaxAuthError(
                "Аккаунт преподавателя ещё не подключён к MAX. Войдите по почте и паролю."
              );
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
    maxEntryChosen,
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
        } else if (isMax && initData && maxAuthChoice === "automatic") {
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
  }, [authenticatedUserId, initData, isMax, maxAuthChoice, maxSignedOut, queryClient]);

  function retryMaxAuth() {
    setLoading(true);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  function resumeMaxAuth() {
    rememberMaxPasswordSession(false);
    try {
      sessionStorage.removeItem(MAX_SIGNED_OUT_KEY);
    } catch {
      // The current WebView can still resume even if storage is unavailable.
    }
    setLoading(true);
    setUserState(null);
    queryClient.clear();
    setMaxSignedOut(false);
    setMaxAuthChoice("automatic");
    setRequestedMaxLinkCode(null);
    setMaxLinkCodeDraft("");
    setAllowMaxAuthWithoutCode(false);
    setMaxAuthError(null);
    setMaxLinkRequired(false);
    setMaxCredentialsRequired(false);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  function chooseMaxEntry() {
    setMaxEntryChosen(true);
    setMaxAuthChoice("entry");
    setMaxAuthError(null);
    setMaxLinkRequired(false);
    setMaxCredentialsRequired(false);
    setMaxLinkPreview(null);
    setLoading(false);
  }

  function chooseMaxTeacher() {
    chooseMaxEntry();
    setMaxAuthChoice("teacher");
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
      rememberMaxPasswordSession(false);
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
    rememberMaxPasswordSession(false);
    setMaxAuthError(null);
    setMaxCredentialsRequired(false);
    setLoading(true);
    setMaxAuthChoice("automatic");
    setRequestedMaxLinkCode("");
    setMaxLinkCodeDraft("");
    setAllowMaxAuthWithoutCode(true);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  async function loginWithPassword(email: string, password: string) {
    setMaxAuthError(null);
    const result = await loginWithCredentials(email, password);
    if (result.user.role === "STUDENT") {
      await logout();
      clearStoredAuth();
      setUserState(null);
      throw new Error("Это аккаунт студента. Для участия в лекции введите код занятия.");
    }
    queryClient.clear();
    setUserState(result.user);
    rememberMaxPasswordSession(true);
    setMaxAuthChoice("password");
    setMaxLinkPreview(null);
    setPendingRegistration(false);
    setMaxCredentialsRequired(false);
    setMaxLinkRequired(false);
    setMaxAuthError(null);
    setLoading(false);
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
    rememberMaxPasswordSession(false);
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
      setMaxAuthChoice("entry");
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
        maxLoginView:
          maxAuthChoice === "teacher"
            ? "teacher"
            : maxAuthChoice === "entry" && (maxEntryChosen || !startParam)
              ? "entry"
              : null,
        maxLinkPreview,
        maxLinkPreviewPending,
        maxLinkCodeInput: maxLinkCodeDraft,
        maxLinkRegistrationPending: pendingRegistration,
        loginWithPassword,
        registerAndLinkMax,
        submitMaxLinkCode,
        confirmMaxLink: confirmPendingMaxLink,
        cancelMaxLinkPreview: cancelPendingMaxLink,
        continueMaxAuth,
        retryMaxAuth,
        resumeMaxAuth,
        chooseMaxLinkCode,
        chooseMaxCredentials,
        chooseMaxEntry,
        chooseMaxTeacher,
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

function readMaxPasswordSession(): boolean {
  try {
    return sessionStorage.getItem(MAX_PASSWORD_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberMaxPasswordSession(enabled: boolean) {
  try {
    if (enabled) sessionStorage.setItem(MAX_PASSWORD_SESSION_KEY, "true");
    else sessionStorage.removeItem(MAX_PASSWORD_SESSION_KEY);
  } catch {
    // The current WebView still retains the selected login method in memory.
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
