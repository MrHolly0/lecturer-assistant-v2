import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MonitorUp, SlidersHorizontal, Square } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LiveSession } from "../app/api/live-api";
import {
  nativeBridge,
  nativeCommand,
  workspaceShare,
  stopWorkspaceProjection
} from "../app/projection/nativeWorkspace";
import { syncProjectionAppearance } from "../app/projection/projectionAppearance";
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
import { getProjectionSettings, sendProjectionCommand } from "../app/api/projection-api";
import { preferredNativeProjectionDevice } from "../app/projection/nativeProjectionPreference";

export function ScreenShareControls({
  courseId,
  session,
  disabled,
  onPause,
  onResume,
  onSessionChange,
  onProjectorSetup,
  nativeWorkspace = false
}: {
  courseId: string;
  session: LiveSession;
  disabled: boolean;
  onPause: () => void;
  onResume: () => void;
  onSessionChange?: (session: LiveSession) => void;
  onProjectorSetup?: () => void;
  nativeWorkspace?: boolean;
}) {
  const controller = workspaceShare();
  const share = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const previewFrame =
    "previewFrame" in share && typeof share.previewFrame === "string"
      ? share.previewFrame
      : undefined;
  const hasPreview = Boolean(share.stream || previewFrame);
  const excluded = nativeBridge()?.captureExclusion?.enabled === true;
  const { isMax, theme } = useMaxBridge();
  const helpers = useQuery({
    queryKey: ["projection-settings"],
    queryFn: getProjectionSettings,
    enabled: !nativeWorkspace,
    refetchInterval: 3000,
    retry: false
  });
  const helpersUnknown = !nativeWorkspace && !helpers.data;
  const helperStateTitle = helpersUnknown
    ? helpers.isError
      ? "Не удалось проверить помощник. Повторите проверку подключения."
      : "Проверяем подключение помощника…"
    : undefined;
  const nativeDevices =
    !nativeWorkspace && helpers.data?.agentAllowed
      ? helpers.data.devices.filter(
          (device) =>
            device.connected &&
            !device.revoked &&
            device.version
              .split(".")
              .map(Number)
              .some((part, index) => (index === 0 ? part > 0 : index === 1 && part >= 2)) &&
            device.activeSessionId === session.id &&
            (device.status === "SHOWING" || device.status === "PAUSED")
        ) ?? []
      : [];
  const preferredDevice = preferredNativeProjectionDevice(courseId, session.id);
  const nativeDevice =
    nativeDevices.find((device) => device.id === preferredDevice) ??
    (nativeDevices.length === 1 ? nativeDevices[0] : undefined);
  const focusNative = useMutation({
    mutationFn: async () => {
      await syncProjectionAppearance(nativeDevice!.id, theme);
      return sendProjectionCommand(courseId, session.id, {
        deviceId: nativeDevice!.id,
        requestId: crypto.randomUUID(),
        type: "FOCUS_PRIVATE_REMOTE",
        displayConfirmed: false
      });
    },
    onError: () =>
      toast.error(
        "Не удалось открыть пульт компонента. Проверьте его подключение в настройке проектора."
      )
  });
  const nativeDeviceId = nativeDevice?.id;
  useEffect(() => {
    if (nativeDeviceId) void syncProjectionAppearance(nativeDeviceId, theme).catch(() => undefined);
  }, [nativeDeviceId, theme, helpers.dataUpdatedAt]);
  const [pult, setPult] = useState(nativeWorkspace);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [remoteWindow, setRemoteWindow] = useState<Window | null>(nativeWorkspace ? window : null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
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
    if (helpersUnknown) return;
    if (nativeDevice) {
      focusNative.mutate();
      return;
    }
    if (nativeDevices.length > 1) {
      onProjectorSetup?.();
      toast.info("Выберите компьютер, на котором нужно открыть пульт.");
      return;
    }
    const opening = openLectureRemoteWindow({ windowKey: session.id });
    setRemoteError(null);
    void opening
      .then((target) => {
        if (mounted.current) {
          setRemoteWindow(target);
          setPult(true);
        } else target.close();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Не удалось вынести пульт.";
        setRemoteError(message);
        toast.error(message);
      });
  };
  const handoffToNativeRemote = () => {
    if (nativeWorkspace || nativeDevices.length === 0) return false;
    void controller.stop();
    setPreview(false);
    setConfirmed(false);
    openRemote();
    if (nativeDevice) toast.info("Выберите источник в отдельном пульте.");
    return true;
  };
  useEffect(() => {
    if (ours) controller.setPaused(session.status === "PAUSED");
  }, [session.status, ours, controller]);
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
    if (helpersUnknown || handoffToNativeRemote()) return;
    setConfirmed(false);
    if (isMax) {
      const path = `/settings/projector?${new URLSearchParams({ courseId, sessionId: session.id, joinCode: session.joinCode })}`;
      const url = `${window.location.origin}${window.location.pathname}#${path}`;
      getMaxWebApp()?.openLink?.(url);
      return;
    }
    if (ours && share.phase === "publishing") void controller.stop();
    setPreview(true);
    void controller.choose({ courseId, sessionId: session.id, joinCode: session.joinCode });
  };
  const prepare = () => {
    if (helpersUnknown || handoffToNativeRemote()) return;
    if (isMax) {
      choose();
      return;
    }
    setConfirmed(false);
    setPreview(true);
  };
  return (
    <>
      {!nativeWorkspace && (
        <Button
          variant="outline"
          disabled={
            !(ours && share.phase === "publishing") &&
            (helpersUnknown ||
              disabled ||
              session.status !== "LIVE" ||
              share.phase === "choosing" ||
              (share.phase === "publishing" && !ours))
          }
          title={helperStateTitle}
          aria-busy={helpersUnknown && helpers.isFetching}
          onClick={
            ours && share.phase === "publishing"
              ? () => {
                  void stopWorkspaceProjection(session.joinCode).then(() => {
                    setPult(false);
                    setRemoteWindow(null);
                  });
                }
              : prepare
          }
        >
          {ours && share.phase === "publishing" ? (
            <Square size={16} aria-hidden="true" />
          ) : (
            <MonitorUp size={18} aria-hidden="true" />
          )}
          {ours && share.phase === "publishing" ? "Остановить показ" : "Демонстрация"}
        </Button>
      )}
      {!nativeWorkspace && (
        <Button
          variant="outline"
          disabled={helpersUnknown}
          title={helperStateTitle}
          aria-busy={helpersUnknown && helpers.isFetching}
          onClick={openRemote}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          Пульт
        </Button>
      )}
      {!nativeWorkspace && helpersUnknown && helpers.isError && (
        <span className="screen-share-remote-error" role="alert">
          Не удалось проверить подключение помощника.{" "}
          <Button variant="link" onClick={() => void helpers.refetch()}>
            Повторить проверку
          </Button>
        </span>
      )}
      {remoteError && (
        <span className="screen-share-remote-error" role="alert">
          {remoteError}
        </span>
      )}
      <Dialog
        open={preview}
        onOpenChange={(open) => {
          if (publishing) return;
          setPreview(open);
          if (!open && share.phase !== "publishing") void controller.stop();
        }}
      >
        <DialogContent className="screen-share-preview">
          <DialogHeader>
            <DialogTitle>
              {share.phase === "preview" ? "Проверьте исходящий кадр" : "Что показать аудитории?"}
            </DialogTitle>
            <DialogDescription>
              Можно показать весь экран, окно приложения или вкладку. Сначала проверьте, что увидит
              аудитория. Выбирайте приложение с учебным материалом. Окно «Проектор» получает
              демонстрацию, его не нужно выбирать источником.
            </DialogDescription>
          </DialogHeader>
          {previewFrame ? (
            <img src={previewFrame} alt="Предпросмотр демонстрации" />
          ) : share.stream ? (
            <video ref={video} muted autoPlay playsInline aria-label="Предпросмотр демонстрации" />
          ) : (
            <div className="screen-share-preview-empty" role="status">
              {share.phase === "choosing"
                ? nativeBridge()?.nativeCapture
                  ? "Подтвердите системное разрешение на запись экрана и выберите окно или экран…"
                  : "Выберите источник в системном окне браузера…"
                : share.error ||
                  "Выберите приложение с учебным материалом. Оно останется на вашем рабочем экране."}
            </div>
          )}
          {share.error && share.stream && <p role="alert">{share.error}</p>}
          {hasPreview && capturesScreen && (
            <p className="screen-share-capture-note" role="note">
              {share.surface === "monitor"
                ? "Выбран весь экран."
                : "Браузер не указал тип источника."}{" "}
              {excluded
                ? "Компонент исключает собственный пульт из захвата. Сверните вкладку лекции и другие личные окна перед показом. Проверьте кадр: остальные окна экрана будут видны."
                : "Пульт и другие окна этого экрана будут видны. Для приватного управления установите компонент в настройке проектора или выберите отдельное окно приложения."}
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
              {capturesScreen && !excluded
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
              disabled={publishing || share.phase === "choosing" || helpersUnknown}
              title={helperStateTitle}
              onClick={choose}
            >
              {hasPreview ? "Другой источник" : "Выбрать окно или экран"}
            </Button>
            <Button
              disabled={
                !confirmed ||
                !hasPreview ||
                share.phase !== "preview" ||
                disabled ||
                publishing ||
                helpersUnknown
              }
              onClick={async () => {
                if (helpersUnknown || handoffToNativeRemote()) return;
                // Reserve the separate window before publishing consumes the click activation.
                if (!nativeWorkspace) openRemote();
                setPublishing(true);
                try {
                  await controller.publish();
                  if (controller.getSnapshot().phase === "publishing") {
                    setPreview(false);
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
          onChooseSource={prepare}
          onSessionChange={onSessionChange}
          initialWindow={remoteWindow}
          onClose={() => {
            if (nativeWorkspace) {
              void controller.stop();
              nativeCommand("close");
              return;
            }
            setPult(false);
            setRemoteWindow(null);
          }}
        />
      )}
    </>
  );
}
