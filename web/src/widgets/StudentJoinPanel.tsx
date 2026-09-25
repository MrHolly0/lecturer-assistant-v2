import type { FormEvent } from "react";
import { Button } from "../shared/ui/button";

interface StudentJoinPanelProps {
  displayName: string;
  userName?: string;
  isPending: boolean;
  isError: boolean;
  disabled?: boolean;
  onDisplayNameChange: (value: string) => void;
  onJoin: () => void;
}

export function StudentJoinPanel({
  displayName,
  userName,
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
      {userName ? (
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
            <input
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder="Имя на лекции"
              maxLength={80}
              minLength={2}
              required
            />
            <Button type="submit" disabled={disabled || isPending || displayName.trim().length < 2}>
              Подключиться
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
