import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../AuthContext";
import { clearStoredAuth, setStoredAuth } from "../auth";
import { apiFetch } from "../api/http";
import { ApiError, userErrorMessage } from "../api/errors";
import { captureAuthTransition, invalidatePendingAuthRefresh } from "../api/refresh";
import type { components } from "../api/schema";
import { messengerLaunch } from "./launch";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { BrandMark } from "../../shared/brand/BrandMark";

type AuthResponse = components["schemas"]["AuthResponse"];
export function MessengerAuthGate({ children }: { children: ReactNode }) {
  const { loading, setUser } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"checking" | "entry" | "ready" | "error">("checking");
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const started = useRef(false);
  const activeRequest = useRef(0);
  const authenticate = async (existingOnly: boolean, linkCode?: string) => {
    if (!messengerLaunch) return;
    const request = ++activeRequest.current;
    invalidatePendingAuthRefresh();
    clearStoredAuth();
    setUser(null);
    queryClient.clear();
    const ensureCurrent = captureAuthTransition();
    setState("checking");
    setError("");
    try {
      const response = await apiFetch("/auth/messenger", {
        method: "POST",
        skipAuthorization: true,
        skipAuthRefresh: true,
        body: JSON.stringify({ ...messengerLaunch, existingOnly, linkCode })
      });
      const auth = (await response.json()) as AuthResponse;
      ensureCurrent();
      if (request !== activeRequest.current) return;
      setStoredAuth({
        accessToken: auth.accessToken,
        refreshMode: messengerLaunch.channel,
        accountId: auth.user.id
      });
      setUser(auth.user);
      setState("ready");
    } catch (cause) {
      if (request !== activeRequest.current) return;
      if (existingOnly && cause instanceof ApiError && cause.status === 422) setState("entry");
      else {
        setState("error");
        setError(
          userErrorMessage(
            cause,
            "Не удалось войти. Переоткройте мини-приложение и повторите попытку."
          )
        );
      }
    }
  };
  useEffect(() => {
    if (!messengerLaunch || loading || started.current) return;
    started.current = true;
    void authenticate(true);
    // One verified launch per opening. Context setters change after each login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  useEffect(() => {
    if (!messengerLaunch) return;
    const signedOut = () => {
      activeRequest.current++;
      setState("entry");
      setError("");
    };
    window.addEventListener("auth:signed-out", signedOut);
    return () => window.removeEventListener("auth:signed-out", signedOut);
  }, []);
  if (!messengerLaunch || state === "ready") return <>{children}</>;
  return (
    <main className="messenger-entry page">
      <div className="live-mobile-brand">
        <BrandMark />
        <strong>Lecturer Assistant</strong>
      </div>
      <h1>{state === "checking" ? "Подключаем аккаунт…" : "Добро пожаловать"}</h1>
      {state === "checking" ? (
        <p role="status" className="muted">
          Проверяем вход через {messengerLaunch.channel === "vk" ? "VK" : "Telegram"}.
        </p>
      ) : (
        <>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <p>
            Если раньше вы пользовались MAX или сайтом, подключите тот же аккаунт по одноразовому
            коду. Так сохранятся группы и история.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void authenticate(false, code.trim());
            }}
            className="messenger-entry__form"
          >
            <label className="field">
              <span>Код подключения из настроек аккаунта</span>
              <Input
                value={code}
                maxLength={64}
                required
                autoComplete="off"
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={!code.trim()}>
              Подключить аккаунт
            </Button>
          </form>
          <Button variant="outline" onClick={() => void authenticate(false)}>
            Продолжить как новый студент
          </Button>
          <Button variant="ghost" onClick={() => void authenticate(true)}>
            Повторить вход
          </Button>
        </>
      )}
    </main>
  );
}
