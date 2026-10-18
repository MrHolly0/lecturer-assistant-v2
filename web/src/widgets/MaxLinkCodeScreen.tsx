import { useEffect, useState, type FormEvent } from "react";
import { Link2 } from "lucide-react";
import { normalizeLinkCode } from "../app/max/deepLink";
import { Button } from "../shared/ui/button";
import { AuthPageFrame } from "./AuthPageFrame";

interface MaxLinkCodeScreenProps {
  initialCode: string;
  error: string | null;
  onSubmit: (code: string) => void;
  onContinue: () => void;
  onCredentials: () => void;
}

export function MaxLinkCodeScreen({
  initialCode,
  error,
  onSubmit,
  onContinue,
  onCredentials
}: MaxLinkCodeScreenProps) {
  const [code, setCode] = useState(initialCode);

  useEffect(() => setCode(initialCode), [initialCode]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.length === 6) onSubmit(code);
  }

  return (
    <AuthPageFrame>
      <section className="auth-card max-link-auth" aria-labelledby="max-link-auth-title">
        <div className="auth-header">
          <span className="max-auth-eyebrow">Мини-приложение MAX</span>
          <div className="max-link-auth__heading">
            <Link2 size={22} aria-hidden="true" />
            <h1 className="auth-title" id="max-link-auth-title">
              Подключить аккаунт
            </h1>
          </div>
          <p className="auth-hint">
            Введите код со страницы «MAX и вход». Сначала проверьте оба аккаунта; MAX подключится
            только после подтверждения.
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Код подключения MAX</span>
            <input
              className="max-link-code-input"
              name="maxLinkCode"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(normalizeLinkCode(event.target.value))}
              placeholder="ABC123"
              inputMode="text"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={code.length !== 6}>
            {error ? "Проверить снова" : "Проверить аккаунт"}
          </Button>
        </form>
        <Button variant="ghost" type="button" onClick={onContinue}>
          Уже подключали MAX? Войти без кода
        </Button>
        <Button variant="ghost" type="button" onClick={onCredentials}>
          Войти по email и паролю
        </Button>
      </section>
    </AuthPageFrame>
  );
}
