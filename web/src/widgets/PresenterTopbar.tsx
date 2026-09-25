import {
  ArrowLeft,
  ChevronDown,
  Monitor,
  Pause,
  PenLine,
  Play,
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
import { Button, LinkButton } from "../shared/ui/button";

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
        <LinkButton
          to={`/courses/${courseId}/materials`}
          variant="ghost"
          className="presenter-back"
          title="Вернуться к материалам"
        >
          <ArrowLeft size={18} />
          <span>Материалы</span>
        </LinkButton>
        <div className="presenter-title-block">
          <strong>{session.lectureTitle}</strong>
          <div className="presenter-meta">
            {session.status === "PAUSED" && (
              <span className="badge presenter-status presenter-status--paused">Пауза</span>
            )}
            <span className="live-code">Код: {session.joinCode}</span>
          </div>
        </div>
      </div>

      <div className="presenter-actions">
        {sessionActive && (
          <>
            <Button className="presenter-connect" type="button" onClick={openConnection}>
              <QrCode size={16} />
              Подключить студентов
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="presenter-menu-trigger" type="button">
                  <Wrench size={16} />
                  Инструменты
                  <ChevronDown size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="presenter-action-menu">
                <DropdownMenuItem onSelect={openProjection}>
                  <Monitor />
                  Открыть проектор
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem
                  checked={drawing}
                  disabled={session.status === "PAUSED"}
                  onCheckedChange={(checked) => onDrawingChange(Boolean(checked))}
                >
                  <PenLine />
                  Рисование
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {session.status === "PAUSED" ? (
              <Button
                type="button"
                title="Продолжить показ слайдов"
                disabled={resumePending}
                onClick={onResume}
              >
                <Play size={16} />
                Продолжить
              </Button>
            ) : (
              <Button
                variant="outline"
                type="button"
                title="Поставить лекцию на паузу"
                disabled={pausePending}
                onClick={onPause}
              >
                <Pause size={16} />
                Пауза
              </Button>
            )}
            <ConfirmActionButton
              title="Завершить лекцию?"
              description="Завершение необратимо: рассылка и управление этой сессией остановятся."
              confirmLabel="Завершить"
              variant="destructive"
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
