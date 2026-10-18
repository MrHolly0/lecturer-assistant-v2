import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { registerByInvitation } from "../app/api/auth-api";
import { useAuth } from "../app/AuthContext";
import { ApiError } from "../app/api/http";
import { landingPath } from "../app/routes";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button } from "../shared/ui/button";
import { AuthPageFrame } from "../widgets/AuthPageFrame";
import { AuthPasswordField } from "../widgets/AuthPasswordField";

export function RegisterPage({ code: initialCode }: { code: string }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState(initialCode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => registerByInvitation(displayName, email, password, code),
    onSuccess: (data) => {
      setUser(data.user);
      navigate(landingPath(data.user.role), { replace: true });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.status === 400
          ? "Недействительный или истёкший код приглашения"
          : "Ошибка регистрации"
      );
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <AuthPageFrame className="register-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-brand app-brand">
            <BrandMark />
            <span>Lecturer Assistant</span>
          </div>
          <h1 className="auth-title">Регистрация</h1>
          <p className="auth-sub">по приглашению</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label className="field">
            <span>Код приглашения</span>
            <input
              name="invitationCode"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              placeholder="XXXX-XXXX"
            />
          </label>
          <label className="field">
            <span>Имя</span>
            <input
              name="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={2}
              autoComplete="name"
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              spellCheck={false}
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <AuthPasswordField
            label="Пароль"
            name="password"
            value={password}
            onValueChange={setPassword}
            required
            minLength={8}
            autoComplete="new-password"
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Создаём аккаунт…" : "Зарегистрироваться"}
          </Button>
        </form>
        <p className="auth-hint">
          <Link to="/login">← Войти в существующий аккаунт</Link>
        </p>
      </div>
    </AuthPageFrame>
  );
}
