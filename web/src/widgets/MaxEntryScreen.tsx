import { useState, type FormEvent } from "react";
import { ArrowLeft, Mail, MessageCircle, QrCode } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import { useMaxBridge } from "../app/max/context";
import { Button } from "../shared/ui/button";
import { AuthPageFrame } from "./AuthPageFrame";

export function MaxEntryScreen() {
  const navigate = useNavigate();
  const { initData } = useMaxBridge();
  const { user, maxSignedOut, continueMaxAuth, chooseMaxTeacher } = useAuth();
  const [code, setCode] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    if (initData && !user && !maxSignedOut) continueMaxAuth();
    navigate(`/s/${encodeURIComponent(normalized)}`);
  }

  return (
    <AuthPageFrame>
      <section className="auth-card max-entry" aria-labelledby="max-entry-title">
        <header className="auth-header">
          <h1 className="auth-title" id="max-entry-title">
            Войти в лекцию
          </h1>
          <p className="auth-hint">Введите код с экрана преподавателя.</p>
        </header>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Код занятия</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="Например, ABC123"
              minLength={4}
              required
            />
          </label>
          <Button type="submit" disabled={!code.trim()}>
            <QrCode aria-hidden="true" /> Войти в лекцию
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            chooseMaxTeacher();
            navigate("/");
          }}
        >
          Я преподаватель
        </Button>
      </section>
    </AuthPageFrame>
  );
}

export function MaxTeacherScreen() {
  const navigate = useNavigate();
  const { maxAuthError, chooseMaxCredentials, resumeMaxAuth, chooseMaxEntry } = useAuth();
  return (
    <AuthPageFrame>
      <section className="auth-card max-teacher-entry" aria-labelledby="max-teacher-title">
        <Button
          type="button"
          variant="ghost"
          className="max-entry-back"
          onClick={() => {
            chooseMaxEntry();
            navigate("/");
          }}
        >
          <ArrowLeft aria-hidden="true" /> К вводу кода занятия
        </Button>
        <header className="auth-header">
          <h1 className="auth-title" id="max-teacher-title">
            Вход преподавателя
          </h1>
          <p className="auth-hint">Выберите способ входа в свой аккаунт.</p>
        </header>
        {maxAuthError && (
          <p className="form-error" role="alert">
            {maxAuthError}
          </p>
        )}
        <Button type="button" onClick={chooseMaxCredentials}>
          <Mail aria-hidden="true" /> Почта и пароль
        </Button>
        <Button type="button" variant="outline" onClick={resumeMaxAuth}>
          <MessageCircle aria-hidden="true" /> Войти через MAX
        </Button>
      </section>
    </AuthPageFrame>
  );
}
