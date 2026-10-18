import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import type { StudentConnectionState } from "../app/api/student-api";
import { Button } from "../shared/ui/button";

interface StudentConnectionBannerProps {
  state: StudentConnectionState;
  lastSyncedAt: Date | null;
  onRetry: () => void;
  syncing: boolean;
  error: boolean;
}

const MESSAGES: Partial<Record<StudentConnectionState, string>> = {
  CONNECTING: "Подключаемся к лекции…",
  RECONNECTING: "Нет связи. Переподключаемся…",
  POLLING: "Поток нестабилен. Обновляем лекцию автоматически.",
  OFFLINE: "Нет интернета. Ждём восстановления сети.",
  ENDED: "Занятие завершено."
};

export function StudentConnectionBanner({
  state,
  lastSyncedAt,
  onRetry,
  syncing,
  error
}: StudentConnectionBannerProps) {
  if ((state === "CONNECTED" || state === "POLLING") && !error && !syncing) return null;

  const message = error
    ? "Не удалось сверить занятие"
    : syncing
      ? state === "CONNECTED"
        ? "Связь есть, сверяем занятие…"
        : MESSAGES[state] ?? "Сверяем занятие…"
      : state === "CONNECTED"
        ? "Данные обновлены с сервера"
        : MESSAGES[state];
  const canRetry = error || state === "RECONNECTING" || state === "POLLING" || state === "OFFLINE";
  const Icon = state === "CONNECTED" && !error ? Wifi : CloudOff;

  return (
    <div
      className={`student-connection student-connection--${state.toLowerCase()}${error ? " student-connection--error" : ""}`}
      role="status"
    >
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{message}</strong>
        {lastSyncedAt && (
          <span>
            Последнее подтверждённое обновление в{" "}
            {lastSyncedAt.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            })}
          </span>
        )}
      </div>
      {canRetry && (
        <Button variant="outline" type="button" onClick={onRetry}>
          <RefreshCw size={16} />
          Повторить сверку
        </Button>
      )}
    </div>
  );
}
