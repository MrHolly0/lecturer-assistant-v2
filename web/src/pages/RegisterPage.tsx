import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { registerByInvitation } from "../app/api/auth-api";
import { useAuth } from "../app/AuthContext";
import { ApiError } from "../app/api/http";

export function RegisterPage({ code: initialCode }: { code: string }) {
  const { setUser } = useAuth();
  const [code, setCode] = useState(initialCode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => registerByInvitation(displayName, email, password, code),
    onSuccess: (data) => {
      setUser(data.user);
      window.location.hash = "#/courses";
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
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">Регистрация</h1>
          <p className="auth-sub">по приглашению</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label className="field">
            <span>Код приглашения</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus={!initialCode}
              placeholder="XXXX-XXXX"
            />
          </label>
          <label className="field">
            <span>Имя</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={2}
              autoFocus={!!initialCode}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? "..." : "Зарегистрироваться"}
          </button>
        </form>
        <p className="auth-hint">
          <a href="#/login">← Войти в существующий аккаунт</a>
        </p>
      </div>
    </div>
  );
}
