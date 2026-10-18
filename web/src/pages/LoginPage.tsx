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
import { Button } from "../shared/ui/button";
import { AuthPageFrame } from "../widgets/AuthPageFrame";
import { AuthPasswordField } from "../widgets/AuthPasswordField";

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
    <AuthPageFrame className="login-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">Вход в аккаунт</h1>
          <p className="auth-sub">Продолжите работу с курсами и занятиями</p>
        </div>

        <form onSubmit={submit} className="auth-form login-page__form">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <AuthPasswordField
            label="Пароль"
            name="password"
            value={password}
            onValueChange={setPassword}
            required
            minLength={8}
            autoComplete="current-password"
          />
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
    </AuthPageFrame>
  );
}
