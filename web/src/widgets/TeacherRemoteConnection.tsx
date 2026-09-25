import { CloudOff, LoaderCircle, Wifi } from "lucide-react";
import type { LiveConnectionState } from "../app/api/live-api";

const labels: Record<LiveConnectionState, string> = {
  connecting: "Подключаемся",
  connected: "На связи",
  reconnecting: "Восстанавливаем связь",
  offline: "Нет сети"
};

export function TeacherRemoteConnection({ state }: { state: LiveConnectionState }) {
  const Icon = state === "connected" ? Wifi : state === "offline" ? CloudOff : LoaderCircle;
  return (
    <div className={`teacher-remote-connection teacher-remote-connection--${state}`} role="status">
      <Icon
        size={15}
        aria-hidden="true"
        className={state === "connecting" || state === "reconnecting" ? "animate-spin" : undefined}
      />
      <span>{labels[state]}</span>
    </div>
  );
}
