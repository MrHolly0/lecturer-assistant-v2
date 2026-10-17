import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../app/api/auth-api";
import { useAuth } from "../app/AuthContext";
import { ApiError } from "../app/api/http";
import { landingPath } from "../app/routes";
import { buildMaxBotUrl } from "../app/max/deepLink";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button } from "../shared/ui/button";
import { ThemeToggle } from "../widgets/ThemeToggle";

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const maxBotUrl = buildMaxBotUrl();

  const loginMut = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (data) => {
      setUser(data.user);
      navigate(landingPath(data.user.role), { replace: true });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.status === 401 ? "Неверный email или пароль" : "Ошибка входа"
      );
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    loginMut.mutate();
  }

  const pending = loginMut.isPending;

  return (
    <div className="auth-shell login-page">
      <div className="auth-card">
        <div className="auth-theme-switch">
          <ThemeToggle compact />
        </div>
        <div className="auth-header">
          <BrandMark className="mx-auto h-16 w-16 text-orange-500" />
          <h1 className="auth-title">Вход в Lecturer Assistant</h1>
          <p className="auth-sub">Продолжите работу с курсами и занятиями</p>
        </div>

        <form onSubmit={submit} className="auth-form login-page__form">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoFocus
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
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Входим…" : "Войти"}
          </Button>
        </form>

        <div className="login-page__alternative">
          <span>Или</span>
          {maxBotUrl ? (
            <Button asChild variant="outline" size="lg">
              <a href={maxBotUrl} target="_blank" rel="noreferrer">
                <MessageCircle size={19} aria-hidden="true" />
                Войти через MAX
              </a>
            </Button>
          ) : (
            <p className="form-warning">Вход через MAX пока не настроен.</p>
          )}
          <p className="auth-max-entry__hint">
            В мини-приложении вход выполнится через ваш аккаунт MAX.
          </p>
        </div>

        <p className="auth-hint">
          Есть код приглашения? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}
