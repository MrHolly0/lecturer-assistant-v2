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
import {
  setLiveProjectionCode,
  type LiveConnectionState,
  type LiveSession
} from "../app/api/live-api";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getMaxWebApp } from "../app/max/bridge";
import { useMaxBridge } from "../app/max/context";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { LocalQrCode } from "./LocalQrCode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { Button, LinkButton } from "../shared/ui/button";
import { SessionGroups } from "./SessionGroups";

interface PresenterTopbarProps {
  courseId: string;
  session: LiveSession;
  drawing: boolean;
  pausePending: boolean;
  resumePending: boolean;
  endPending: boolean;
  connection: LiveConnectionState;
  syncedAt: Date | null;
  syncing: boolean;
  syncError: boolean;
  onRefresh: () => void;
  onDrawingChange: (active: boolean) => void;
  onSessionChange: (session: LiveSession) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}

export function PresenterTopbar({
  courseId,
  session,
  drawing,
  pausePending,
  resumePending,
  endPending,
  connection,
  syncedAt,
  syncing,
  syncError,
  onRefresh,
  onDrawingChange,
  onSessionChange,
  onPause,
  onResume,
  onEnd
}: PresenterTopbarProps) {
  const maxEnvironment = useMaxBridge();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [projectionBlocked, setProjectionBlocked] = useState(false);
  const sessionActive = session.status === "LIVE" || session.status === "PAUSED";
  const showJoinCode = session.showJoinCode;
  const joinUrl = buildMaxJoinUrl(session.joinCode);
  const openProjection = () => {
    const url = `${window.location.origin}/#/projection/${encodeURIComponent(session.joinCode)}`;
    if (maxEnvironment.isMax && getMaxWebApp()?.openLink) {
      try {
        getMaxWebApp()?.openLink?.(url);
      } catch {
        toast.error("MAX не открыл внешний браузер. Попробуйте ещё раз.");
      }
      return;
    }
    const projectionWindow = window.open(url, "lecturer-projection", "popup,width=1280,height=720");
    if (projectionWindow) {
      projectionWindow.focus();
      setProjectionBlocked(false);
    } else setProjectionBlocked(true);
  };
  const projectionCodeMutation = useMutation({
    mutationFn: (show: boolean) => setLiveProjectionCode(courseId, session.id, show),
    onSuccess: onSessionChange,
    onError: () => toast.error("Не удалось обновить код на проекторе. Повторите попытку.")
  });
  const connectionLabel = syncError
    ? "Снимок не обновлён"
    : syncing
      ? connection === "connected"
        ? "Связь есть, сверяем занятие"
        : "Сверяем занятие"
      : connection === "connected"
        ? "Данные обновлены"
        : "Нет связи с сервером";

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
            <span className="live-code">Код занятия: {session.joinCode}</span>
            <SessionGroups groups={session.groups} compact />
          </div>
        </div>
      </div>

      {drawing && (
        <Button
          type="button"
          variant="outline"
          className="presenter-drawing-exit"
          onClick={() => onDrawingChange(false)}
        >
          Готово
        </Button>
      )}

      <div className="presenter-actions">
        {sessionActive && (
          <>
            <span
              className={`presenter-sync presenter-sync--${syncError ? "error" : syncing ? "pending" : connection}`}
              role="status"
            >
              <span aria-hidden="true" />
              {connectionLabel}
              {!syncing && syncedAt && (
                <time dateTime={syncedAt.toISOString()}>
                  {" "}
                  ·{" "}
                  {syncedAt.toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                  })}
                </time>
              )}
              {syncError && (
                <button type="button" onClick={onRefresh}>
                  Повторить
                </button>
              )}
            </span>
            <Button
              className="presenter-connect"
              type="button"
              onClick={() => setConnectionOpen(true)}
            >
              <QrCode size={16} />
              Код занятия
            </Button>

            <Button
              className="presenter-projector"
              type="button"
              variant="outline"
              onClick={openProjection}
            >
              <Monitor size={16} aria-hidden="true" /> Проектор
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={projectionCodeMutation.isPending}
              onClick={() => projectionCodeMutation.mutate(!showJoinCode)}
            >
              {showJoinCode ? "Вернуться к слайду на проекторе" : "Показать код на проекторе"}
            </Button>
            {projectionCodeMutation.isError && (
              <span className="presenter-action-error" role="alert">
                Не удалось обновить код.{" "}
                <button type="button" onClick={() => projectionCodeMutation.mutate(!showJoinCode)}>
                  Повторить
                </button>
              </span>
            )}

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
                <DropdownMenuItem
                  onSelect={() =>
                    maxEnvironment.setPreferredTheme(
                      maxEnvironment.theme === "dark" ? "light" : "dark"
                    )
                  }
                >
                  {maxEnvironment.theme === "dark" ? "Светлая тема" : "Тёмная тема"}
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
      <Dialog open={connectionOpen} onOpenChange={setConnectionOpen}>
        <DialogContent className="presenter-connection-dialog">
          <DialogHeader>
            <DialogTitle>Подключить студентов</DialogTitle>
            <DialogDescription>
              Покажите QR-код студентам или продиктуйте код занятия.
            </DialogDescription>
          </DialogHeader>
          <strong className="presenter-connection-code">{session.joinCode}</strong>
          {joinUrl ? (
            <>
              <LocalQrCode value={joinUrl} label="Открыть занятие в MAX" />
              <a
                className="presenter-connection-link"
                href={joinUrl}
                target="_blank"
                rel="noreferrer"
              >
                Открыть ссылку для студентов
              </a>
            </>
          ) : (
            <p className="muted">
              Ссылка MAX не настроена. Студенты могут ввести код в приложении.
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={projectionBlocked} onOpenChange={setProjectionBlocked}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Окно проектора заблокировано</DialogTitle>
            <DialogDescription>
              Разрешите всплывающие окна для сайта и повторите. Проектор можно открыть отдельной
              вкладкой.
            </DialogDescription>
          </DialogHeader>
          <div className="presenter-popup-actions">
            <Button type="button" onClick={openProjection}>
              Повторить открытие
            </Button>
            <a
              className="ui-button ui-button--outline"
              href={`${window.location.origin}/#/projection/${encodeURIComponent(session.joinCode)}`}
              target="_blank"
              rel="noreferrer"
            >
              Открыть во вкладке
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
