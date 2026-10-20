import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MonitorUp, Presentation, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { LiveSession } from "../app/api/live-api";
import { screenShare } from "../app/sharing/screenShare";
import { useMaxBridge } from "../app/max/context";
import { getMaxWebApp } from "../app/max/bridge";
import { openLectureRemoteWindow } from "../app/projection/lectureRemoteWindow";
import { closePublicProjection } from "../app/projection/browserProjection";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { FloatingLectureRemote } from "./FloatingLectureRemote";

export function ScreenShareControls({
  courseId,
  session,
  disabled,
  onPause,
  onResume,
  onSessionChange
}: {
  courseId: string;
  session: LiveSession;
  disabled: boolean;
  onPause: () => void;
  onResume: () => void;
  onSessionChange?: (session: LiveSession) => void;
}) {
  const share = useSyncExternalStore(screenShare.subscribe, screenShare.getSnapshot);
  const { isMax } = useMaxBridge();
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [remoteWindow, setRemoteWindow] = useState<Window | null>(null);
  const mounted = useRef(true);
  const video = useRef<HTMLVideoElement>(null);
  const ours = share.scope?.sessionId === session.id;
  const sharing = ours && share.phase === "publishing";
  const previewSource = ours
    ? share.pendingSource ?? (share.phase === "preview" ? share : null)
    : null;
  const previewStream = previewSource?.stream;
  const hasPreview = Boolean(previewStream);
  const capturesScreen =
    previewSource?.surface === "monitor" || previewSource?.surface === "unknown";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (ours) screenShare.setPaused(session.status === "PAUSED");
    if (session.status === "ENDED" || session.status === "ARCHIVED") {
      if (ours) void screenShare.stop();
      closePublicProjection(session.joinCode);
      setRemoteWindow(null);
    }
  }, [session.status, session.joinCode, ours]);
  useEffect(() => {
    if (!preview || !previewStream || !video.current) return;
    const element = video.current;
    element.srcObject = previewStream;
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [preview, previewStream]);

  const openRemote = () => {
    void openLectureRemoteWindow({ windowKey: session.id })
      .then((target) => {
        if (mounted.current) setRemoteWindow(target);
        else target.close();
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Не удалось открыть пульт.")
      );
  };
  const prepare = () => {
    if (isMax) {
      const url =
        window.location.origin +
        window.location.pathname +
        "#/courses/" +
        encodeURIComponent(courseId) +
        "/sessions/" +
        encodeURIComponent(session.id) +
        "/presenter";
      try {
        const bridge = getMaxWebApp();
        if (!bridge?.openLink) throw new Error();
        bridge.openLink(url);
      } catch {
        toast.error("Не удалось открыть браузер. Откройте занятие в браузере компьютера.");
      }
      return;
    }
    setConfirmed(false);
    setPreview(true);
  };
  const choose = () => {
    setConfirmed(false);
    void screenShare.choose({ courseId, sessionId: session.id, joinCode: session.joinCode });
  };
  return (
    <>
      <Button
        variant="outline"
        disabled={
          !sharing &&
          (disabled ||
            session.status !== "LIVE" ||
            share.phase === "choosing" ||
            (share.phase === "publishing" && !ours))
        }
        onClick={sharing ? () => void screenShare.stop() : prepare}
      >
        {sharing ? <Presentation size={18} /> : <MonitorUp size={18} />}
        {sharing ? "Вернуться к презентации" : "Демонстрация"}
      </Button>
      <Button variant="outline" onClick={openRemote}>
        <SlidersHorizontal size={18} />
        Пульт
      </Button>
      <Dialog
        open={preview}
        onOpenChange={(open) => {
          if (publishing) return;
          setPreview(open);
          if (!open && ours) {
            if (sharing) screenShare.cancelSelection();
            else void screenShare.stop();
          }
        }}
      >
        <DialogContent className="screen-share-preview">
          <DialogHeader>
            <DialogTitle>
              {hasPreview ? "Проверьте исходящий кадр" : "Что показать аудитории?"}
            </DialogTitle>
            <DialogDescription>
              Выберите экран, окно приложения или вкладку с учебным материалом. Окно «Проектор»
              получает демонстрацию, его не нужно выбирать источником.
            </DialogDescription>
          </DialogHeader>
          {hasPreview ? (
            <video ref={video} muted autoPlay playsInline aria-label="Предпросмотр демонстрации" />
          ) : (
            <div className="screen-share-preview-empty" role="status">
              {ours && share.choosing
                ? "Выберите источник в системном окне браузера…"
                : "Выберите приложение с учебным материалом. Оно останется на вашем рабочем экране."}
            </div>
          )}
          {sharing && (
            <p role="status">
              Аудитория продолжает видеть текущий источник до подтверждения замены.
            </p>
          )}
          {hasPreview && (
            <p className="screen-share-source-name">Источник: {previewSource?.sourceName}</p>
          )}
          {ours && share.error && <p role="alert">{share.error}</p>}
          {hasPreview && capturesScreen && (
            <p className="screen-share-capture-note" role="note">
              При показе всего экрана пульт и другие окна этого экрана будут видны аудитории. Чтобы
              оставить управление приватным, выберите отдельное окно приложения.
            </p>
          )}
          <label className="screen-share-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={!hasPreview || publishing}
            />
            <span>
              {capturesScreen
                ? "Понимаю, что кадр может содержать другие окна"
                : "В кадре только материал для аудитории"}
            </span>
          </label>
          <p className="screen-share-network-note">
            Передаётся видео выбранного источника, без звука. Если видео недоступно, участники
            получают обновляемые кадры.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={publishing || share.choosing || (!ours && share.phase === "publishing")}
              onClick={choose}
            >
              {hasPreview ? "Другой источник" : "Выбрать окно или экран"}
            </Button>
            <Button
              disabled={
                !confirmed ||
                !hasPreview ||
                (!share.pendingSource && share.phase !== "preview") ||
                disabled ||
                session.status !== "LIVE" ||
                publishing
              }
              onClick={async () => {
                setPublishing(true);
                try {
                  await screenShare.publish();
                  if (
                    screenShare.getSnapshot().phase === "publishing" &&
                    !screenShare.getSnapshot().pendingSource
                  )
                    setPreview(false);
                } finally {
                  setPublishing(false);
                }
              }}
            >
              {publishing ? "Подключаем…" : sharing ? "Заменить источник" : "Показывать аудитории"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {remoteWindow && (
        <FloatingLectureRemote
          courseId={courseId}
          session={session}
          disabled={disabled}
          onPause={onPause}
          onResume={onResume}
          onChooseSource={() => {
            window.focus();
            prepare();
          }}
          onSessionChange={onSessionChange}
          initialWindow={remoteWindow}
          onClose={() => setRemoteWindow(null)}
        />
      )}
    </>
  );
}
