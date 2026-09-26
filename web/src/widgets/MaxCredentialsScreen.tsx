import { useState, type FormEvent } from "react";
import { ApiError } from "../app/api/http";
import { Button } from "../shared/ui/button";

interface MaxCredentialsScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (
    name: string,
    email: string,
    password: string,
    invitationCode: string
  ) => Promise<void>;
  onStudent: () => void;
}

export function MaxCredentialsScreen({
  onLogin,
  onRegister,
  onStudent
}: MaxCredentialsScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      if (mode === "login") await onLogin(email.trim(), password);
      else await onRegister(name.trim(), email.trim(), password, invitationCode.trim());
    } catch (cause) {
      setError(credentialsErrorMessage(cause, mode));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card max-credentials" aria-labelledby="max-credentials-title">
        <header className="auth-header">
          <span className="max-auth-eyebrow">Вход через MAX</span>
          <h1 className="auth-title" id="max-credentials-title">
            {mode === "login" ? "Войти преподавателем" : "Создать учётную запись"}
          </h1>
          <p className="auth-hint">
            {mode === "login"
              ? "Если входите впервые, укажите логин и пароль. MAX подключится к вашему аккаунту автоматически."
              : "Введите приглашение администратора и задайте пароль. MAX подключится сразу после регистрации."}
          </p>
        </header>
        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <>
              <label className="field">
                <span>Код приглашения</span>
                <input
                  value={invitationCode}
                  onChange={(event) => setInvitationCode(event.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <label className="field">
                <span>Имя</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  minLength={2}
                  required
                />
              </label>
            </>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "register" ? 8 : undefined}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending
              ? "Подключаем MAX…"
              : mode === "login"
                ? "Войти и подключить MAX"
                : "Зарегистрироваться и войти"}
          </Button>
        </form>
        <div className="max-credentials__other">
          <Button
            variant="ghost"
            type="button"
            disabled={pending}
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Есть приглашение от администратора" : "Уже есть логин и пароль"}
          </Button>
          <Button variant="ghost" type="button" disabled={pending} onClick={onStudent}>
            Я студент — войти через MAX
          </Button>
        </div>
      </section>
    </main>
  );
}

function credentialsErrorMessage(error: unknown, mode: "login" | "register") {
  if (error instanceof ApiError) {
    if (mode === "login" && error.status === 401) return "Неверный email или пароль.";
    if (mode === "register" && error.status === 400) {
      return "Приглашение недействительно или истекло. Попросите администратора создать новое.";
    }
    if (mode === "register" && error.status === 409) return "Этот email уже зарегистрирован.";
    if (error.status === 403) return "Учётная запись отключена администратором.";
    if (error.status === 503) return "Вход через MAX временно недоступен.";
  }
  return error instanceof Error
    ? error.message
    : "Не удалось войти. Проверьте подключение и попробуйте снова.";
}
