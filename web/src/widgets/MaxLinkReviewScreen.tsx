import type { MaxLinkPreview } from "../app/api/auth-api";
import { Button } from "../shared/ui/button";
import { AuthPageFrame } from "./AuthPageFrame";

interface MaxLinkReviewScreenProps {
  preview: MaxLinkPreview;
  pending: boolean;
  registrationPending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const roleLabels: Record<MaxLinkPreview["targetAccount"]["role"], string> = {
  ADMIN: "Администратор",
  LECTURER: "Преподаватель",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

export function MaxLinkReviewScreen({
  preview,
  pending,
  registrationPending,
  error,
  onConfirm,
  onCancel
}: MaxLinkReviewScreenProps) {
  const current = preview.currentAccount;
  return (
    <AuthPageFrame className="max-link-review-shell">
      <section className="auth-card max-link-review" aria-labelledby="max-link-review-title">
        <header className="auth-header">
          <span className="max-auth-eyebrow">Проверка перед привязкой</span>
          <h1 className="auth-title" id="max-link-review-title">
            К какому аккаунту подключить MAX?
          </h1>
          <p className="auth-hint">
            {preview.alreadyLinked
              ? "Этот профиль MAX уже связан с выбранным аккаунтом. Подтвердите вход, чтобы продолжить."
              : current
                ? "После подтверждения MAX будет отключён от текущего аккаунта и подключён к выбранному."
                : "Этот профиль MAX пока не связан с аккаунтом."}
          </p>
        </header>

        <dl className="max-link-review__accounts">
          <div>
            <dt>Сейчас в MAX</dt>
            {current ? (
              <dd>
                <strong>{current.displayName}</strong>
                <span>{current.email}</span>
                <small>{roleLabels[current.role]}</small>
              </dd>
            ) : (
              <dd className="muted">Не подключён</dd>
            )}
          </div>
          <div className="max-link-review__target">
            <dt>Подключить к аккаунту</dt>
            <dd>
              <strong>{preview.targetAccount.displayName}</strong>
              <span>{preview.targetAccount.email}</span>
              <small>{roleLabels[preview.targetAccount.role]}</small>
            </dd>
          </div>
        </dl>

        <p className="max-link-review__expiry">
          Подтверждение действует до{" "}
          <time dateTime={preview.expiresAt}>
            {new Date(preview.expiresAt).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit"
            })}
          </time>
          .
        </p>
        {registrationPending && (
          <p className="max-link-review__registration-note">
            Учётная запись уже создана. Если отменить проверку, она останется без подключения MAX.
          </p>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="max-link-review__actions">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending ? "Подключаем…" : "Подтвердить и войти"}
          </Button>
        </div>
      </section>
    </AuthPageFrame>
  );
}
