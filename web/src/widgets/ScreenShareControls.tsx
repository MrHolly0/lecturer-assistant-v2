import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MonitorUp, MessageCircle, Square } from "lucide-react";
import { toast } from "sonner";
import type { LiveSession } from "../app/api/live-api";
import { screenShare } from "../app/sharing/screenShare";
import { useMaxBridge } from "../app/max/context";
import { getMaxWebApp } from "../app/max/bridge";
import { openLectureRemoteWindow } from "../app/projection/lectureRemoteWindow";
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
  onResume
}: {
  courseId: string;
  session: LiveSession;
  disabled: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const share = useSyncExternalStore(screenShare.subscribe, screenShare.getSnapshot);
  const { isMax } = useMaxBridge();
  const [pult, setPult] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [remoteWindow, setRemoteWindow] = useState<Window | null>(null);
  const mounted = useRef(true);
  const video = useRef<HTMLVideoElement>(null);
  const ours = share.scope?.sessionId === session.id;
  const capturesScreen = share.surface === "monitor" || share.surface === "unknown";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const openRemote = () => {
    const opening = openLectureRemoteWindow({ windowKey: session.id });
    setPult(true);
    void opening
      .then((target) => {
        if (mounted.current) setRemoteWindow(target);
        else target.close();
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Не удалось вынести пульт.")
      );
  };
  useEffect(() => {
    if (ours) screenShare.setPaused(session.status === "PAUSED");
  }, [session.status, ours]);
  useEffect(() => {
    if (!preview || !share.stream || !video.current) return;
    const element = video.current;
    element.srcObject = share.stream;
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [preview, share.stream]);
  useEffect(() => {
    if (share.phase === "publishing" && ours) setPreview(false);
  }, [share.phase, ours]);
  const choose = () => {
    setConfirmed(false);
    if (isMax) {
      const path = `/settings/projector?${new URLSearchParams({ courseId, sessionId: session.id, joinCode: session.joinCode })}`;
      const url = `${window.location.origin}${window.location.pathname}#${path}`;
      getMaxWebApp()?.openLink?.(url);
      return;
    }
    setPreview(true);
    void screenShare.choose({ courseId, sessionId: session.id, joinCode: session.joinCode });
  };
  return (
    <>
      <Button
        variant="outline"
        disabled={
          !(ours && share.phase === "publishing") &&
          (disabled ||
            session.status !== "LIVE" ||
            share.phase === "choosing" ||
            (share.phase === "publishing" && !ours))
        }
        onClick={ours && share.phase === "publishing" ? () => void screenShare.stop() : choose}
      >
        {ours && share.phase === "publishing" ? (
          <Square size={16} aria-hidden="true" />
        ) : (
          <MonitorUp size={18} aria-hidden="true" />
        )}
        {ours && share.phase === "publishing" ? "Остановить демонстрацию" : "Начать демонстрацию"}
      </Button>
      <Button variant="outline" onClick={openRemote}>
        <MessageCircle size={18} aria-hidden="true" />
        Вынести пульт
      </Button>
      <Dialog
        open={preview}
        onOpenChange={(open) => {
          if (publishing) return;
          setPreview(open);
          if (!open && share.phase !== "publishing") void screenShare.stop();
        }}
      >
        <DialogContent className="screen-share-preview">
          <DialogHeader>
            <DialogTitle>Проверьте исходящий кадр</DialogTitle>
            <DialogDescription>
              Можно показать весь экран, окно приложения или вкладку. Сначала проверьте, что увидит
              аудитория.
            </DialogDescription>
          </DialogHeader>
          {share.stream ? (
            <video ref={video} muted autoPlay playsInline aria-label="Предпросмотр демонстрации" />
          ) : (
            <div className="screen-share-preview-empty" role="status">
              {share.phase === "choosing"
                ? "Выберите источник в окне браузера…"
                : share.error || "Источник ещё не выбран"}
            </div>
          )}
          {share.error && share.stream && <p role="alert">{share.error}</p>}
          {share.stream && capturesScreen && (
            <p className="screen-share-capture-note" role="note">
              {share.surface === "monitor"
                ? "Выбран весь экран."
                : "Браузер не указал тип источника."}{" "}
              Пульт, личные вопросы и другие окна на этом экране тоже будут видны. Браузер не
              скрывает их из демонстрации. Для приватного управления выберите отдельное окно
              приложения или оставьте пульт на другом экране.
            </p>
          )}
          <label className="screen-share-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={!share.stream || publishing}
            />
            <span>
              {capturesScreen
                ? "Понимаю, что видны все окна выбранного экрана"
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
              disabled={publishing || share.phase === "choosing"}
              onClick={choose}
            >
              Другой источник
            </Button>
            <Button
              disabled={!confirmed || !share.stream || disabled || publishing}
              onClick={async () => {
                setPublishing(true);
                try {
                  await screenShare.publish();
                  if (screenShare.getSnapshot().phase === "publishing") {
                    setPreview(false);
                    if (!capturesScreen) setPult(true);
                  }
                } finally {
                  setPublishing(false);
                }
              }}
            >
              {publishing ? "Подключаем…" : "Показывать аудитории"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pult && (
        <FloatingLectureRemote
          courseId={courseId}
          session={session}
          disabled={disabled}
          onPause={onPause}
          onResume={onResume}
          initialWindow={remoteWindow}
          onClose={() => {
            setPult(false);
            setRemoteWindow(null);
          }}
        />
      )}
    </>
  );
}
