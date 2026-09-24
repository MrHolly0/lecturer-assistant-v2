import { RefreshCw, WifiOff } from "lucide-react";
import type { StudentConnectionState } from "../app/api/student-api";

interface StudentConnectionBannerProps {
  state: StudentConnectionState;
  lastSyncedAt: Date | null;
  onRetry: () => void;
}

const MESSAGES: Partial<Record<StudentConnectionState, string>> = {
  CONNECTING: "Подключаемся к лекции…",
  RECONNECTING: "Нет связи. Переподключаемся…",
  POLLING: "Поток нестабилен. Обновляем лекцию автоматически.",
  OFFLINE: "Нет интернета. Ждём восстановления сети."
};

export function StudentConnectionBanner({
  state,
  lastSyncedAt,
  onRetry
}: StudentConnectionBannerProps) {
  const message = MESSAGES[state];
  if (!message) return null;
  const canRetry = state === "RECONNECTING" || state === "POLLING" || state === "OFFLINE";

  return (
    <div className={`student-connection student-connection--${state.toLowerCase()}`} role="status">
      <WifiOff size={18} aria-hidden="true" />
      <div>
        <strong>{message}</strong>
        {lastSyncedAt && (
          <span>
            Последнее обновление в{" "}
            {lastSyncedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {canRetry && (
        <button className="btn-ghost" type="button" onClick={onRetry}>
          <RefreshCw size={16} />
          Повторить
        </button>
      )}
    </div>
  );
}
