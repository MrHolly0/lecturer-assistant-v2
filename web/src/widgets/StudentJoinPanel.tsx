import type { FormEvent } from "react";
import { Button } from "../shared/ui/button";

interface StudentJoinPanelProps {
  displayName: string;
  userName?: string;
  canResume?: boolean;
  isPending: boolean;
  isError: boolean;
  disabled?: boolean;
  onDisplayNameChange: (value: string) => void;
  onJoin: () => void;
}

export function StudentJoinPanel({
  displayName,
  userName,
  canResume = false,
  isPending,
  isError,
  disabled = false,
  onDisplayNameChange,
  onJoin
}: StudentJoinPanelProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onJoin();
  }

  return (
    <section className="student-action-panel">
      {canResume ? (
        <div className="student-profile-join">
          <h2>Вернуться на занятие</h2>
          <p className="muted">Продолжите с прежним участием и именем.</p>
          <Button disabled={isPending} onClick={onJoin}>
            {isPending ? "Возвращаем…" : "Вернуться"}
          </Button>
        </div>
      ) : userName ? (
        <div className="student-profile-join" aria-live="polite">
          <h2>Подключаем к лекции</h2>
          {isError ? (
            <>
              <p className="form-error" role="alert">
                Не удалось подключиться от имени {userName}.
              </p>
              <Button type="button" disabled={isPending} onClick={onJoin}>
                Попробовать снова
              </Button>
            </>
          ) : (
            <p className="muted">Имя участника: {userName}</p>
          )}
        </div>
      ) : (
        <>
          <h2>Как вас показать преподавателю?</h2>
          <form onSubmit={submit} className="student-join-form">
            <label htmlFor="student-display-name">Имя на лекции</label>
            <input
              id="student-display-name"
              autoComplete="given-name"
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder="Имя на лекции"
              maxLength={80}
              minLength={2}
              required
            />
            <p className="muted">Это имя используется на текущем занятии.</p>
            <Button type="submit" disabled={disabled || isPending || displayName.trim().length < 2}>
              Подключиться
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
