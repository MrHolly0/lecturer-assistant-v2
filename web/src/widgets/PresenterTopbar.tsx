import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Monitor,
  Pause,
  PenLine,
  Play,
  Presentation,
  QrCode,
  Square,
  Wrench
} from "lucide-react";
import type { LiveSession } from "../app/api/live-api";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import { ConfirmActionButton } from "./ConfirmActionButton";

interface PresenterTopbarProps {
  courseId: string;
  sessionId: string;
  session: LiveSession;
  drawing: boolean;
  pausePending: boolean;
  resumePending: boolean;
  endPending: boolean;
  onDrawingChange: (active: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}

const STATUS_LABELS: Record<LiveSession["status"], string> = {
  SCHEDULED: "Запланирована",
  LIVE: "В эфире",
  PAUSED: "Пауза",
  ENDED: "Завершена",
  ARCHIVED: "В архиве"
};

export function PresenterTopbar({
  courseId,
  sessionId,
  session,
  drawing,
  pausePending,
  resumePending,
  endPending,
  onDrawingChange,
  onPause,
  onResume,
  onEnd
}: PresenterTopbarProps) {
  const sessionActive = session.status === "LIVE" || session.status === "PAUSED";
  const openProjection = () =>
    window.open(
      `/#/courses/${courseId}/sessions/${sessionId}/projection`,
      "projection",
      "width=1280,height=720"
    );
  const openConnection = () =>
    window.open(
      `/#/courses/${courseId}/sessions/${sessionId}/join`,
      "session-join",
      "width=560,height=760"
    );

  return (
    <header className="presenter-topbar">
      <div className="presenter-heading">
        <Link
          to={`/courses/${courseId}/materials`}
          className="presenter-back"
          title="Вернуться к материалам"
        >
          <ArrowLeft size={18} />
          <span>Материалы</span>
        </Link>
        <div className="presenter-title-block">
          <strong>{session.lectureTitle}</strong>
          <div className="presenter-meta">
            <span
              className={`badge presenter-status presenter-status--${session.status.toLowerCase()}`}
            >
              {STATUS_LABELS[session.status]}
            </span>
            <span className="live-code">Код: {session.joinCode}</span>
          </div>
        </div>
      </div>

      <div className="presenter-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="btn-ghost presenter-menu-trigger" type="button">
              <Presentation size={16} />
              Показ
              <ChevronDown size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="presenter-action-menu">
            <DropdownMenuItem onSelect={openProjection}>
              <Monitor />
              Открыть проектор
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {sessionActive && (
          <>
            <button
              className="btn-primary presenter-connect"
              type="button"
              onClick={openConnection}
            >
              <QrCode size={16} />
              Подключить студентов
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="btn-ghost presenter-menu-trigger" type="button">
                  <Wrench size={16} />
                  Инструменты
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="presenter-action-menu">
                <DropdownMenuCheckboxItem
                  checked={drawing}
                  onCheckedChange={(checked) => onDrawingChange(Boolean(checked))}
                >
                  <PenLine />
                  Рисование
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {session.status === "PAUSED" ? (
              <button
                className="btn-primary"
                type="button"
                title="Продолжить показ слайдов"
                disabled={resumePending}
                onClick={onResume}
              >
                <Play size={16} />
                Продолжить
              </button>
            ) : (
              <button
                className="btn-ghost"
                type="button"
                title="Поставить лекцию на паузу"
                disabled={pausePending}
                onClick={onPause}
              >
                <Pause size={16} />
                Пауза
              </button>
            )}
            <ConfirmActionButton
              title="Завершить лекцию?"
              description="Завершение необратимо: рассылка и управление этой сессией остановятся."
              confirmLabel="Завершить"
              className="btn-danger-outline"
              disabled={endPending}
              onConfirm={onEnd}
            >
              <Square size={16} />
              Завершить
            </ConfirmActionButton>
          </>
        )}
      </div>
    </header>
  );
}
