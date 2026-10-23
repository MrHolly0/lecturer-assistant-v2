import { useState, type FormEvent } from "react";
import { ApiError } from "../app/api/http";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import { Button } from "../shared/ui/button";
import { AuthPageFrame } from "./AuthPageFrame";
import { AuthPasswordField } from "./AuthPasswordField";
import { PersonNameFields } from "./PersonNameFields";
import { formatPersonName } from "../shared/lib/personName";

interface MaxCredentialsScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (
    name: string,
    email: string,
    password: string,
    invitationCode: string
  ) => Promise<void>;
  onCode: () => void;
  error: string | null;
}

export function MaxCredentialsScreen({
  onLogin,
  onRegister,
  onCode,
  error: externalError
}: MaxCredentialsScreenProps) {
  const { chooseMaxTeacher } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState({ familyName: "", givenName: "", middleName: "" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    // Password managers can fill the native fields without a React change event.
    const form = new FormData(event.currentTarget);
    const submittedEmail = String(form.get("email") ?? "").trim();
    const submittedPassword = String(form.get("password") ?? "");
    const submittedInvitationCode = String(form.get("invitationCode") ?? "").trim();
    const displayName = formatPersonName(name);
    if (
      mode === "register" &&
      (!name.familyName.trim() || !name.givenName.trim() || displayName.length > 200)
    ) {
      setError("Укажите фамилию и имя. ФИО должно содержать не больше 200 символов.");
      return;
    }
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    setPending(true);
    try {
      if (mode === "login") await onLogin(submittedEmail, submittedPassword);
      else
        await onRegister(displayName, submittedEmail, submittedPassword, submittedInvitationCode);
    } catch (cause) {
      setError(credentialsErrorMessage(cause, mode));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthPageFrame>
      <section className="auth-card max-credentials" aria-labelledby="max-credentials-title">
        <Button
          type="button"
          variant="ghost"
          className="max-entry-back"
          disabled={pending}
          onClick={chooseMaxTeacher}
        >
          <ArrowLeft aria-hidden="true" /> Способы входа
        </Button>
        <header className="auth-header">
          <span className="max-auth-eyebrow">Для преподавателей</span>
          <h1 className="auth-title" id="max-credentials-title">
            {mode === "login" ? "Войти преподавателем" : "Создать учётную запись"}
          </h1>
          <p className="auth-hint">
            {mode === "login"
              ? "Введите почту и пароль. Затем подтвердите подключение этого MAX к вашей учётной записи, чтобы входить без пароля."
              : "После регистрации проверьте аккаунты и подтвердите привязку MAX. Если отменить, учётная запись останется созданной без подключения MAX."}
          </p>
        </header>
        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <>
              <label className="field">
                <span>Код приглашения</span>
                <input
                  name="invitationCode"
                  spellCheck={false}
                  value={invitationCode}
                  onChange={(event) => setInvitationCode(event.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <PersonNameFields value={name} onChange={setName} disabled={pending} />
            </>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete={mode === "login" ? "username" : "email"}
              required
            />
          </label>
          <AuthPasswordField
            label="Пароль"
            name="password"
            value={password}
            onValueChange={setPassword}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "register" ? 8 : undefined}
            required
          />
          {(error ?? externalError) && (
            <p className="form-error" role="alert">
              {error ?? externalError}
            </p>
          )}
          {error && externalError && externalError !== error && (
            <p className="form-warning" role="status">
              {externalError}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending
              ? "Проверяем…"
              : mode === "login"
                ? "Продолжить и подключить MAX"
                : "Создать аккаунт и проверить"}
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
          <Button variant="ghost" type="button" disabled={pending} onClick={onCode}>
            Подключить аккаунт по коду
          </Button>
        </div>
      </section>
    </AuthPageFrame>
  );
}

function credentialsErrorMessage(error: unknown, mode: "login" | "register") {
  if (error instanceof ApiError) {
    if (mode === "login" && error.status === 401) {
      const reason = error.details?.message ?? error.details?.detail;
      if (reason === "Invalid MAX initData") return error.message;
      if (reason === "Invalid credentials") return "Неверный email или пароль.";
      return "Не удалось подтвердить вход. Закройте мини-приложение MAX и откройте его заново.";
    }
    if (mode === "register" && error.status === 400) {
      return "Приглашение недействительно или истекло. Попросите администратора создать новое.";
    }
    if (mode === "register" && error.status === 409) return "Этот email уже зарегистрирован.";
    if (mode === "login" && error.status === 409) {
      return "Этот аккаунт уже связан с другим MAX. Отвяжите его в кабинете преподавателя.";
    }
    if (error.status === 403) return "Учётная запись отключена администратором.";
    if (error.status === 503) return "Вход через MAX временно недоступен.";
  }
  return error instanceof Error
    ? error.message
    : "Не удалось войти. Проверьте подключение и попробуйте снова.";
}
