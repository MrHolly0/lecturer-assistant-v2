import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { login, bootstrapAdmin } from "../app/api/auth-api";
import { useAuth } from "../app/AuthContext";
import { ApiError } from "../app/api/http";

type Mode = "login" | "bootstrap";

export function LoginPage() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  const loginMut = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (data) => {
      setUser(data.user);
      window.location.hash = "#/courses";
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.status === 401 ? "Неверный email или пароль" : "Ошибка входа"
      );
    }
  });

  const bootstrapMut = useMutation({
    mutationFn: () => bootstrapAdmin(displayName, email, password),
    onSuccess: (data) => {
      setUser(data.user);
      window.location.hash = "#/courses";
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Пользователи уже существуют — войдите обычным способом"
          : "Ошибка создания администратора"
      );
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "login") loginMut.mutate();
    else bootstrapMut.mutate();
  }

  const pending = loginMut.isPending || bootstrapMut.isPending;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">Lecturer Assistant</h1>
          <p className="auth-sub">v2</p>
        </div>

        <div className="tab-row">
          <button
            type="button"
            className={`tab ${mode === "login" ? "tab--active" : ""}`}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Войти
          </button>
          <button
            type="button"
            className={`tab ${mode === "bootstrap" ? "tab--active" : ""}`}
            onClick={() => {
              setMode("bootstrap");
              setError("");
            }}
          >
            Первый запуск
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === "bootstrap" && (
            <label className="field">
              <span>Имя</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                minLength={2}
                autoFocus
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={mode === "login"}
            />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "..." : mode === "login" ? "Войти" : "Создать аккаунт администратора"}
          </button>
        </form>

        <p className="auth-hint">
          Есть код приглашения? <a href="#/register">Зарегистрироваться</a>
        </p>
      </div>
    </div>
  );
}
