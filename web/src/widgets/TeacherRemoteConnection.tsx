import { CloudOff, LoaderCircle, Wifi } from "lucide-react";
import type { LiveConnectionState } from "../app/api/live-api";
import { Button } from "../shared/ui/button";

export function TeacherRemoteConnection({
  state,
  syncing,
  syncedAt,
  syncError,
  onRetry
}: {
  state: LiveConnectionState;
  syncing: boolean;
  syncedAt: Date | null;
  syncError: boolean;
  onRetry: () => void;
}) {
  const Icon = state === "connected" ? Wifi : state === "offline" ? CloudOff : LoaderCircle;
  const label = syncError
    ? "Состояние не сверено"
    : syncing
      ? state === "connected"
        ? "Связь есть, сверяем состояние"
        : "Сверяем состояние"
      : state === "connected"
        ? "Данные обновлены"
        : state === "offline"
          ? "Нет сети"
          : "Восстанавливаем связь";
  return (
    <div
      className={`teacher-remote-connection teacher-remote-connection--${state}${syncError || syncing ? " teacher-remote-connection--unverified" : ""}`}
      role="status"
    >
      <Icon
        size={15}
        aria-hidden="true"
        className={state === "connecting" || state === "reconnecting" ? "animate-spin" : undefined}
      />
      <span>
        {label}
        {!syncing && syncedAt
          ? ` · ${syncedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
          : ""}
        {(syncError || state !== "connected") && (
          <small>
            Показано последнее подтверждённое состояние. Управление станет доступно после сверки.
          </small>
        )}
      </span>
      {(syncError || state !== "connected") && (
        <Button variant="outline" type="button" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}
