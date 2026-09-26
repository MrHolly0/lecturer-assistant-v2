import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, MessageCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../app/api/auth-api";
import { useAuth } from "../app/AuthContext";
import { ApiError } from "../app/api/http";
import { landingPath } from "../app/routes";
import { buildMaxBotUrl } from "../app/max/deepLink";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button } from "../shared/ui/button";

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [browserLoginOpen, setBrowserLoginOpen] = useState(false);
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
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <BrandMark className="mx-auto h-16 w-16 text-orange-500" />
          <h1 className="auth-title">Lecturer Assistant</h1>
          <p className="auth-sub">Рабочее место преподавателя</p>
        </div>

        <div className="auth-max-entry">
          {maxBotUrl ? (
            <Button asChild size="lg">
              <a href={maxBotUrl} target="_blank" rel="noreferrer">
                <MessageCircle size={19} aria-hidden="true" />
                Открыть в MAX
              </a>
            </Button>
          ) : (
            <p className="form-warning">Вход через MAX пока не настроен.</p>
          )}
          <p className="auth-max-entry__hint">
            Бот откроет мини-приложение и войдёт через ваш аккаунт MAX.
          </p>
        </div>

        <div className="auth-browser-entry">
          <Button
            type="button"
            variant="outline"
            className="auth-browser-entry__toggle"
            aria-expanded={browserLoginOpen}
            onClick={() => setBrowserLoginOpen((value) => !value)}
          >
            Войти в браузере
            <ChevronDown
              size={17}
              aria-hidden="true"
              className={browserLoginOpen ? "auth-browser-entry__chevron--open" : undefined}
            />
          </Button>

          {browserLoginOpen && (
            <div className="auth-browser-entry__form">
              <form onSubmit={submit} className="auth-form">
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
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
                  />
                </label>
                {error && <p className="form-error">{error}</p>}
                <Button type="submit" disabled={pending}>
                  {pending ? "..." : "Войти"}
                </Button>
              </form>
            </div>
          )}
        </div>

        <p className="auth-hint">
          Есть код приглашения? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}
