import type { FormEvent } from "react";

interface StudentJoinPanelProps {
  displayName: string;
  userName?: string;
  isPending: boolean;
  isError: boolean;
  onDisplayNameChange: (value: string) => void;
  onJoin: () => void;
}

export function StudentJoinPanel({
  displayName,
  userName,
  isPending,
  isError,
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
              <button className="btn-primary" type="button" disabled={isPending} onClick={onJoin}>
                Попробовать снова
              </button>
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
            <button
              className="btn-primary"
              type="submit"
              disabled={isPending || displayName.trim().length < 2}
            >
              Подключиться
            </button>
          </form>
        </>
      )}
    </section>
  );
}
