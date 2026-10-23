import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
import {
  invalidatePendingAuthRefresh,
  refreshAuthSession,
  RefreshIdentityMismatchError,
  RefreshUnavailableError
} from "./api/refresh";
import { clearStoredAuth, getStoredAuth } from "./auth";
import { useMaxBridge } from "./max/context";
import { normalizeLinkCode, readMaxLinkCode } from "./max/deepLink";
import {
  clearLegacyMaxSignedOut,
  clearMaxResume,
  maxIdentityFromInitData,
  readMaxResume,
  readMaxSignedOut,
  setMaxSignedOut,
  writeMaxResume
} from "./max/authResume";
import type { MaxResumeRecord } from "./max/authResume";

type UserProfile = components["schemas"]["UserProfile"];
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
  const maxIdentity = maxIdentityFromInitData(initData);
  const authRevisionRef = useRef(0);
  const lastMaxIdentityRef = useRef<string | null>(maxIdentity);
  const maxResumeRetryRef = useRef<{ identity: string; record: MaxResumeRecord } | null>(null);
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxAuthError, setMaxAuthError] = useState<string | null>(null);
  const [maxSignedOut, setMaxSignedOutState] = useState(() => readMaxSignedOut(initData));
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

  const advanceAuthRevision = useCallback(() => {
    authRevisionRef.current += 1;
    invalidatePendingAuthRefresh();
  }, []);

  useEffect(() => {
    let active = true;
    const previousIdentity = lastMaxIdentityRef.current;
    if (isMax && maxIdentity && previousIdentity && maxIdentity !== previousIdentity) {
      lastMaxIdentityRef.current = maxIdentity;
      advanceAuthRevision();
      maxResumeRetryRef.current = null;
      clearStoredAuth();
      queryClient.clear();
      clearLegacyMaxSignedOut();
      setUserState(null);
      setMaxSignedOutState(readMaxSignedOut(initData));
      setMaxAuthChoice("entry");
      setMaxAuthError(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    if (isMax && maxIdentity && !previousIdentity) lastMaxIdentityRef.current = maxIdentity;

    const expireAuth = () => {
      if (isMax && initData && !maxSignedOut && maxAuthChoice === "automatic") {
        setLoading(true);
        void loginWithMax(initData, undefined, undefined, true)
          .then(({ user: restored }) => {
            if (!active) return;
            setUserState(restored);
            writeMaxResume(initData, String(restored.id), "max");
            setMaxSignedOut(initData, false);
            setMaxSignedOutState(false);
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
      if (!maxSignedOut && refreshed?.user) {
        setUserState(refreshed.user);
        if (isMax && initData) {
          const mode =
            maxAuthChoice === "password" || readMaxResume(initData)?.mode === "password"
              ? "password"
              : "max";
          writeMaxResume(initData, String(refreshed.user.id), mode);
          setMaxSignedOut(initData, false);
        }
      }
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
    if (
      isMax &&
      !getStoredAuth() &&
      !maxEntryChosen &&
      (maxAuthChoice === "entry" || maxAuthChoice === "session" || maxAuthChoice === "password")
    ) {
      const resume = readMaxResume(initData);
      const resumeIdentity = maxIdentity;
      if (resume && resumeIdentity) {
        const resumeRevision = authRevisionRef.current;
        const canApply = () => active && authRevisionRef.current === resumeRevision;
        const recover = recoverMaxResume(initData, resume);
        recover
          .then(({ user: restored }) => {
            if (!canApply()) return;
            if (!restored) {
              clearMaxResume(initData);
              maxResumeRetryRef.current = null;
              setMaxAuthChoice("teacher");
              setMaxAuthError("Сессия завершена. Войдите по почте и паролю.");
              return;
            }
            setUserState(restored);
            setMaxAuthChoice(resume.mode === "password" ? "password" : "session");
            writeMaxResume(initData, String(restored.id), resume.mode);
            maxResumeRetryRef.current = null;
            setMaxSignedOut(initData, false);
            setMaxSignedOutState(false);
            setMaxAuthError(null);
          })
          .catch((error: unknown) => {
            if (!canApply()) return;
            setUserState(null);
            setMaxAuthChoice("teacher");
            if (error instanceof RefreshIdentityMismatchError) {
              clearMaxResume(initData);
              maxResumeRetryRef.current = null;
              setMaxAuthError(
                "Сохранённая сессия относится к другому аккаунту. Войдите по почте и паролю."
              );
            } else if (error instanceof RefreshUnavailableError) {
              maxResumeRetryRef.current = { identity: resumeIdentity, record: resume };
              setMaxAuthError(
                "Не удалось восстановить сессию из-за временной ошибки сети. Попробуйте ещё раз."
              );
            } else {
              setMaxAuthError(maxAuthErrorMessage(error, false));
            }
          })
          .finally(() => {
            if (canApply()) setLoading(false);
          });
        return cleanup;
      }
    }
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
            if (!active) return;
            setUserState(currentUser);
            // Existing sessions also need a hint before MAX recreates the WebView.
            writeMaxResume(
              initData,
              String(currentUser.id),
              maxAuthChoice === "password" ? "password" : "max"
            );
          })
          .catch((error: unknown) => {
            if (!active) return;
            if (isDefinitiveAuthError(error)) {
              clearStoredAuth();
              clearMaxResume(initData);
              setUserState(null);
              setMaxAuthChoice("teacher");
            }
            setMaxAuthError(maxAuthErrorMessage(error, false));
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
            writeMaxResume(initData, String(maxUser.id), "max");
            setMaxSignedOut(initData, false);
            setMaxSignedOutState(false);
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
          writeMaxResume(initData, String(maxUser.id), "max");
          setMaxSignedOut(initData, false);
          setMaxSignedOutState(false);
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
        .catch(() => {
          // Network and server failures leave a recoverable session unchanged.
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return cleanup;
    }
    getCurrentUser()
      .then((currentUser) => {
        if (active) setUserState(currentUser);
      })
      .catch((error: unknown) => {
        if (isDefinitiveAuthError(error)) clearStoredAuth();
      })
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
    maxIdentity,
    maxSignedOut,
    queryClient,
    requestedMaxLinkCode,
    startParam,
    advanceAuthRevision
  ]);

  const authenticatedUserId = user?.id;
  useEffect(() => {
    if (!isMax || !maxIdentity || maxSignedOut || user) return;
    let active = true;
    let checking = false;
    let lastAttempt = 0;
    const retry = async () => {
      const pending = maxResumeRetryRef.current;
      if (
        !pending ||
        pending.identity !== maxIdentity ||
        document.visibilityState !== "visible" ||
        checking ||
        Date.now() - lastAttempt < 20_000
      ) {
        return;
      }
      checking = true;
      lastAttempt = Date.now();
      const revision = authRevisionRef.current;
      try {
        const result = await recoverMaxResume(initData, pending.record);
        if (!active || revision !== authRevisionRef.current || maxSignedOut) return;
        if (!result.user) {
          clearMaxResume(initData);
          maxResumeRetryRef.current = null;
          setMaxAuthChoice("teacher");
          setMaxAuthError("Сессия завершена. Войдите по почте и паролю.");
          return;
        }
        maxResumeRetryRef.current = null;
        setUserState(result.user);
        setMaxAuthChoice(pending.record.mode === "password" ? "password" : "session");
        writeMaxResume(initData, String(result.user.id), pending.record.mode);
        setMaxAuthError(null);
      } catch (error) {
        if (!active || revision !== authRevisionRef.current) return;
        if (error instanceof RefreshIdentityMismatchError) {
          clearMaxResume(initData);
          maxResumeRetryRef.current = null;
          setMaxAuthChoice("teacher");
          setMaxAuthError(
            "Сохранённая сессия относится к другому аккаунту. Войдите по почте и паролю."
          );
        }
        // Temporary failures keep the account hint and retry on the next foreground event.
      } finally {
        checking = false;
      }
    };
    const retryWhenVisible = () => void retry();
    document.addEventListener("visibilitychange", retryWhenVisible);
    window.addEventListener("focus", retryWhenVisible);
    window.addEventListener("online", retryWhenVisible);
    window.addEventListener("pageshow", retryWhenVisible);
    const interval = window.setInterval(retryWhenVisible, 30_000);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", retryWhenVisible);
      window.removeEventListener("focus", retryWhenVisible);
      window.removeEventListener("online", retryWhenVisible);
      window.removeEventListener("pageshow", retryWhenVisible);
      window.clearInterval(interval);
    };
  }, [initData, isMax, maxIdentity, maxSignedOut, user]);

  useEffect(() => {
    if (user || maxSignedOut || !getStoredAuth()?.accessToken) return;
    let active = true;
    let checking = false;
    let lastAttempt = 0;
    const retry = async () => {
      const token = getStoredAuth()?.accessToken;
      if (
        !token ||
        document.visibilityState !== "visible" ||
        checking ||
        Date.now() - lastAttempt < 20_000
      ) {
        return;
      }
      checking = true;
      lastAttempt = Date.now();
      try {
        const currentUser = await getCurrentUser();
        if (!active || maxSignedOut || getStoredAuth()?.accessToken !== token) return;
        setUserState(currentUser);
        if (isMax && initData) {
          const mode = maxAuthChoice === "password" ? "password" : "max";
          writeMaxResume(initData, String(currentUser.id), mode);
        }
        setMaxAuthError(null);
      } catch (error) {
        if (!active || getStoredAuth()?.accessToken !== token) return;
        if (isDefinitiveAuthError(error)) {
          clearStoredAuth();
          if (isMax) {
            clearMaxResume(initData);
            setMaxAuthChoice("teacher");
          }
        }
      } finally {
        checking = false;
      }
    };
    const retryWhenVisible = () => void retry();
    document.addEventListener("visibilitychange", retryWhenVisible);
    window.addEventListener("focus", retryWhenVisible);
    window.addEventListener("online", retryWhenVisible);
    window.addEventListener("pageshow", retryWhenVisible);
    const interval = window.setInterval(retryWhenVisible, 30_000);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", retryWhenVisible);
      window.removeEventListener("focus", retryWhenVisible);
      window.removeEventListener("online", retryWhenVisible);
      window.removeEventListener("pageshow", retryWhenVisible);
      window.clearInterval(interval);
    };
  }, [initData, isMax, maxAuthChoice, maxSignedOut, user]);

  useEffect(() => {
    if (!authenticatedUserId || maxSignedOut) return;
    let lastCheck = Date.now();
    let checking = false;
    let active = true;
    const revalidate = async () => {
      if (document.visibilityState !== "visible" || checking || Date.now() - lastCheck < 60_000)
        return;
      lastCheck = Date.now();
      checking = true;
      const revision = authRevisionRef.current;
      try {
        const refreshed = await refreshAuthSession();
        if (!active || revision !== authRevisionRef.current || maxSignedOut) return;
        if (refreshed) {
          setUserState(refreshed.user);
          if (isMax && initData) {
            const mode = maxAuthChoice === "password" ? "password" : "max";
            writeMaxResume(initData, String(refreshed.user.id), mode);
          }
          await queryClient.invalidateQueries({ type: "active" });
        } else if (isMax && initData && maxAuthChoice === "automatic") {
          const restored = await loginWithMax(initData, undefined, undefined, true);
          if (!active || revision !== authRevisionRef.current || maxSignedOut) return;
          setUserState(restored.user);
          writeMaxResume(initData, String(restored.user.id), "max");
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
      active = false;
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
      window.clearInterval(interval);
    };
  }, [authenticatedUserId, initData, isMax, maxAuthChoice, maxSignedOut, queryClient]);

  function retryMaxAuth() {
    advanceAuthRevision();
    setLoading(true);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  function resumeMaxAuth() {
    advanceAuthRevision();
    maxResumeRetryRef.current = null;
    rememberMaxPasswordSession(false);
    setMaxSignedOut(initData, false);
    setLoading(true);
    setUserState(null);
    queryClient.clear();
    setMaxSignedOutState(false);
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
    advanceAuthRevision();
    maxResumeRetryRef.current = null;
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
    advanceAuthRevision();
    maxResumeRetryRef.current = null;
    setMaxSignedOut(initData, false);
    setMaxAuthError(null);
    setMaxLinkCodeDraft("");
    setRequestedMaxLinkCode(null);
    setMaxAuthChoice("code");
    setMaxLinkRequired(true);
    setMaxCredentialsRequired(false);
    setMaxSignedOutState(false);
  }

  function chooseMaxCredentials() {
    advanceAuthRevision();
    maxResumeRetryRef.current = null;
    setMaxSignedOut(initData, false);
    setMaxAuthError(null);
    setMaxLinkCodeDraft("");
    setMaxAuthChoice("credentials");
    setMaxLinkRequired(false);
    setMaxCredentialsRequired(true);
    setMaxSignedOutState(false);
  }

  function submitMaxLinkCode(code: string) {
    advanceAuthRevision();
    setMaxAuthError(null);
    setLoading(true);
    const normalizedCode = normalizeLinkCode(code);
    setMaxLinkCodeDraft(normalizedCode);
    setRequestedMaxLinkCode(normalizedCode);
    setMaxAuthAttempt((attempt) => attempt + 1);
  }

  async function confirmPendingMaxLink() {
    if (!initData || !maxLinkPreview) return;
    advanceAuthRevision();
    const revision = authRevisionRef.current;
    setMaxLinkPreviewPending(true);
    setMaxAuthError(null);
    try {
      const { user: linkedUser } = await confirmMaxLinkRequest(
        initData,
        maxLinkPreview.confirmationToken
      );
      if (revision !== authRevisionRef.current) return;
      rememberMaxPasswordSession(false);
      queryClient.clear();
      setMaxAuthChoice("session");
      setRequestedMaxLinkCode(null);
      setAllowMaxAuthWithoutCode(false);
      setUserState(linkedUser);
      writeMaxResume(initData, String(linkedUser.id), "max");
      setMaxLinkPreview(null);
      setMaxLinkCodeDraft("");
      setPendingRegistration(false);
      setMaxLinkRequired(false);
      setMaxCredentialsRequired(false);
      setMaxSignedOut(initData, false);
      setMaxSignedOutState(false);
      setMaxAuthError(null);
    } catch (error) {
      if (revision !== authRevisionRef.current) return;
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
      if (revision === authRevisionRef.current) setMaxLinkPreviewPending(false);
    }
  }

  function cancelPendingMaxLink() {
    advanceAuthRevision();
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
    advanceAuthRevision();
    maxResumeRetryRef.current = null;
    rememberMaxPasswordSession(false);
    setMaxSignedOut(initData, false);
    setMaxSignedOutState(false);
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
    advanceAuthRevision();
    const revision = authRevisionRef.current;
    setMaxAuthError(null);
    if (isMax) {
      if (!initData)
        throw new Error(
          "MAX не передал данные для подключения. Закройте и снова откройте мини-приложение."
        );
      const preview = await previewMaxLink({ initData, email, password });
      if (revision !== authRevisionRef.current) return;
      if (preview.targetAccount.role === "STUDENT")
        throw new Error("Это аккаунт студента. Для участия в лекции введите код занятия.");
      clearStoredAuth();
      queryClient.clear();
      setUserState(null);
      setPendingRegistration(false);
      setMaxLinkPreview(preview);
      setMaxLinkRequired(false);
      setMaxCredentialsRequired(false);
      return;
    }
    const result = await loginWithCredentials(email, password);
    if (result.user.role === "STUDENT") {
      await logout();
      clearStoredAuth();
      clearMaxResume(initData);
      setUserState(null);
      throw new Error("Это аккаунт студента. Для участия в лекции введите код занятия.");
    }
    queryClient.clear();
    setUserState(result.user);
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
    advanceAuthRevision();
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
    advanceAuthRevision();
    await logout();
    advanceAuthRevision();
    rememberMaxPasswordSession(false);
    clearStoredAuth();
    queryClient.clear();
    if (isMax) {
      clearMaxResume(initData);
      setMaxSignedOut(initData, true);
      setMaxSignedOutState(true);
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

  function setContextUser(nextUser: UserProfile | null) {
    advanceAuthRevision();
    setUserState(nextUser);
    if (isMax && initData && nextUser) {
      const mode = maxAuthChoice === "password" ? "password" : "max";
      writeMaxResume(initData, String(nextUser.id), mode);
      setMaxSignedOut(initData, false);
      setMaxSignedOutState(false);
    }
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
        setUser: setContextUser,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function readMaxPasswordSession(): boolean {
  try {
    return sessionStorage.getItem(MAX_PASSWORD_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

async function recoverMaxResume(
  initData: string | null | undefined,
  resume: MaxResumeRecord
): Promise<{ user: UserProfile | null }> {
  const refreshed = await refreshAuthSession({ expectedUserId: resume.accountId });
  if (refreshed) return { user: refreshed.user };
  if (resume.mode === "max" && initData) {
    const restored = await loginWithMax(initData, undefined, undefined, true);
    return { user: restored.user };
  }
  return { user: null };
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

function isDefinitiveAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
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
  if (error instanceof RefreshUnavailableError) {
    return "Вход временно недоступен из-за ошибки сети. Попробуйте ещё раз.";
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
