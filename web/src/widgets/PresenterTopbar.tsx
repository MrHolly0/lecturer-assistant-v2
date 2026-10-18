import { ChevronDown, Monitor, Pause, PenLine, Play, QrCode, Square, Wrench } from "lucide-react";
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { Button } from "../shared/ui/button";
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
  const commandsBlocked = connection !== "connected" || syncing || syncError;
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
        <div className="presenter-title-block">
          <strong>{session.lectureTitle}</strong>
          <div className="presenter-meta" role="status">
            {session.status === "PAUSED" && (
              <span className="badge presenter-status presenter-status--paused">Пауза</span>
            )}
            <SessionGroups groups={session.groups} compact />
            <span className="presenter-header-sync">
              {connectionLabel}
              {!syncing && syncedAt ? ` в ${syncedAt.toLocaleTimeString("ru-RU")}` : ""}
            </span>
          </div>
        </div>
        <span
          className={`badge presenter-status presenter-status--${commandsBlocked ? "offline" : session.status.toLowerCase()}`}
        >
          {commandsBlocked
            ? "Сверяем состояние"
            : session.status === "PAUSED"
              ? "Пауза"
              : "В эфире"}
        </span>
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
              variant="outline"
              type="button"
              onClick={() => setConnectionOpen(true)}
            >
              <QrCode size={16} />
              Код занятия: {session.joinCode}
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
                <DropdownMenuCheckboxItem
                  checked={drawing}
                  disabled={session.status === "PAUSED" || commandsBlocked}
                  onCheckedChange={(checked) => onDrawingChange(Boolean(checked))}
                >
                  <PenLine />
                  Рисование
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem onSelect={openProjection}>
                  <Monitor />
                  Открыть проектор
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>На проекторе</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={showJoinCode ? "code" : "slide"}
                  onValueChange={(value) => projectionCodeMutation.mutate(value === "code")}
                >
                  <DropdownMenuRadioItem
                    value="slide"
                    disabled={commandsBlocked || projectionCodeMutation.isPending}
                  >
                    Слайд лекции
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="code"
                    disabled={commandsBlocked || projectionCodeMutation.isPending}
                  >
                    Код подключения
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <p className="presenter-projection-hint">Слайды переключаются синхронно</p>
              </DropdownMenuContent>
            </DropdownMenu>

            {session.status === "PAUSED" ? (
              <Button
                type="button"
                title="Продолжить показ слайдов"
                disabled={resumePending || commandsBlocked}
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
                disabled={pausePending || commandsBlocked}
                onClick={onPause}
              >
                <Pause size={16} />
                Пауза
              </Button>
            )}
            <div
              className={`presenter-finish-actions${syncError || connection !== "connected" ? " presenter-finish-actions--retry" : ""}`}
            >
              <ConfirmActionButton
                title="Завершить лекцию?"
                description="Показ на проекторе и у студентов закончится. Данные останутся в итогах занятия. Продолжить это занятие будет нельзя."
                confirmLabel="Завершить"
                variant="destructive"
                disabled={endPending || commandsBlocked}
                onConfirm={() => {
                  if (!commandsBlocked) onEnd();
                }}
              >
                <Square size={16} />
                Завершить
              </ConfirmActionButton>
              {(syncError || connection !== "connected") && (
                <Button type="button" variant="outline" disabled={syncing} onClick={onRefresh}>
                  Повторить сверку
                </Button>
              )}
            </div>
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
              Разрешите всплывающие окна для сайта и повторите. Можно открыть проектор в текущем
              окне.
            </DialogDescription>
          </DialogHeader>
          <div className="presenter-popup-actions">
            <Button type="button" onClick={openProjection}>
              Повторить открытие
            </Button>
            <a
              className="ui-button ui-button--outline"
              href={`${window.location.origin}/#/projection/${encodeURIComponent(session.joinCode)}`}
            >
              Открыть в этом окне
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
