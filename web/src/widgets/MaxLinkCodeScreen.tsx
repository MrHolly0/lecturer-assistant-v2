import { useEffect, useState, type FormEvent } from "react";
import { Link2 } from "lucide-react";
import { normalizeLinkCode } from "../app/max/deepLink";

interface MaxLinkCodeScreenProps {
  initialCode: string;
  error: string | null;
  onSubmit: (code: string) => void;
  onContinue: () => void;
}

export function MaxLinkCodeScreen({
  initialCode,
  error,
  onSubmit,
  onContinue
}: MaxLinkCodeScreenProps) {
  const [code, setCode] = useState(initialCode);

  useEffect(() => setCode(initialCode), [initialCode]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.length === 6) onSubmit(code);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card max-link-auth" aria-labelledby="max-link-auth-title">
        <div className="max-link-auth__icon" aria-hidden="true">
          <Link2 size={24} />
        </div>
        <div className="auth-header">
          <span className="max-auth-eyebrow">Мини-приложение MAX</span>
          <h1 className="auth-title" id="max-link-auth-title">
            Подключить аккаунт
          </h1>
          <p className="auth-hint">
            Введите код со страницы «Подключить MAX» в кабинете преподавателя.
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Код привязки</span>
            <input
              className="max-link-code-input"
              value={code}
              onChange={(event) => setCode(normalizeLinkCode(event.target.value))}
              placeholder="ABC123"
              inputMode="text"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn-primary" type="submit" disabled={code.length !== 6}>
            {error ? "Попробовать снова" : "Подключить и войти"}
          </button>
        </form>
        <button className="btn-ghost" type="button" onClick={onContinue}>
          Уже подключали MAX? Войти
        </button>
      </section>
    </main>
  );
}
