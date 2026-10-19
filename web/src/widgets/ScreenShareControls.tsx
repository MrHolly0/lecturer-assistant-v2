import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { MonitorUp, SlidersHorizontal, Square } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LiveSession } from "../app/api/live-api";
import {
  nativeBridge,
  nativeCommand,
  nativeCapture,
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
  const scope = { courseId, sessionId: session.id, joinCode: session.joinCode };
  useLayoutEffect(() => {
    if (controller === nativeCapture) {
      nativeCapture.registerScope({ courseId, sessionId: session.id, joinCode: session.joinCode });
    }
  }, [controller, courseId, session.id, session.joinCode]);
  const share = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const previewFrame =
    "previewFrame" in share && typeof share.previewFrame === "string"
      ? share.previewFrame
      : undefined;
  const nativeSourceKind = "sourceKind" in share ? share.sourceKind : undefined;
  const nativeCaptureMode = "captureMode" in share ? share.captureMode : undefined;
  const nativeErrorCode = "errorCode" in share ? share.errorCode : undefined;
  const displayPermissionDenied = "permissionDenied" in share && share.permissionDenied === true;
  const hasPreview = Boolean(share.stream || previewFrame);
  const nativeCapabilities = nativeBridge();
  const systemWindowPickerAvailable =
    nativeCapabilities?.platform === "MACOS" &&
    nativeCapabilities.captureModes?.window === true &&
    nativeCapabilities.captureModes.application === true;
  const manualWindowAvailable =
    nativeCapabilities?.platform === "MACOS" &&
    nativeCapabilities.nativeCapture &&
    nativeCapabilities.captureModes?.manualWindow === true;
  const manualWindowFallbackAvailable =
    manualWindowAvailable &&
    ((share.phase === "choosing" && nativeCaptureMode !== "manual-window") ||
      share.phase === "error");
  const manualWindowError = share.phase === "error" && nativeCaptureMode === "manual-window";
  const systemPickerTimedOut = nativeErrorCode === "CAPTURE_SYSTEM_PICKER_TIMED_OUT";
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
      await syncProjectionAppearance(nativeDevice!.id, theme, { force: true });
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
  useEffect(() => {
    if (
      controller === nativeCapture &&
      (share.phase === "choosing" || share.phase === "preview" || share.phase === "error")
    ) {
      setPreview(true);
    }
  }, [controller, share.phase]);
  const choose = (mode: "window" | "display" | "manual-window" = "window") => {
    if (helpersUnknown || handoffToNativeRemote()) return;
    setConfirmed(false);
    if (isMax && !nativeBridge()?.nativeCapture) {
      const path = `/settings/projector?${new URLSearchParams({ courseId, sessionId: session.id, joinCode: session.joinCode })}`;
      const url = `${window.location.origin}${window.location.pathname}#${path}`;
      getMaxWebApp()?.openLink?.(url);
      return;
    }
    if (ours && share.phase === "publishing") void controller.stop();
    setPreview(true);
    if (nativeBridge()?.nativeCapture) void nativeCapture.choose(scope, mode);
    else void controller.choose(scope);
  };
  const cancelSourceChoice = () => {
    setConfirmed(false);
    setPreview(false);
    void controller.stop();
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
              {systemWindowPickerAvailable
                ? "Выберите отдельное окно с учебным материалом. Окно «Проектор» получает показ автоматически."
                : "Можно показать весь экран, окно приложения или вкладку. Сначала проверьте, что увидит аудитория. Выбирайте приложение с учебным материалом. Окно «Проектор» получает демонстрацию, его не нужно выбирать источником."}
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
                  ? "permissionPending" in share && share.permissionPending
                    ? nativeCaptureMode === "manual-window"
                      ? "Подтвердите запрос macOS на доступ к записи экрана. Аудитории будет передано выбранное окно…"
                      : nativeCaptureMode === "display"
                        ? "Подтвердите запрос macOS на запись всего экрана…"
                        : "Подтвердите системный запрос на выбор источника…"
                    : nativeCaptureMode === "manual-window"
                      ? "Выберите окно в списке помощника…"
                      : systemWindowPickerAvailable
                        ? "Выберите окно или приложение в системном меню…"
                        : "Выберите источник в системном меню…"
                  : "Выберите источник в системном окне браузера…"
                : share.error ||
                  "Выберите приложение с учебным материалом. Оно останется на вашем рабочем экране."}
            </div>
          )}
          {share.sourceName && share.phase === "preview" && (
            <p className="screen-share-source-name" role="status">
              Источник: {share.sourceName}
            </p>
          )}
          {nativeSourceKind === "application" && share.phase === "preview" && (
            <p className="screen-share-capture-note" role="note">
              Будут видны окна выбранного приложения. Чтобы показать одну вкладку, выберите её
              отдельное окно.
            </p>
          )}
          {share.error && <p role="alert">{share.error}</p>}
          {manualWindowFallbackAvailable && (
            <details
              className="screen-share-manual-window-fallback"
              open={manualWindowError || (share.phase === "error" && systemPickerTimedOut)}
            >
              <summary>
                {manualWindowError
                  ? "Повторить ручной выбор окна?"
                  : "Не появилось системное меню?"}
              </summary>
              {manualWindowError ? (
                <p>
                  Для ручного выбора нужен доступ macOS к записи экрана. Если доступа нет, разрешите
                  его для помощника в системных настройках и повторите выбор. После выбора
                  передаётся только указанное окно.
                </p>
              ) : (
                <p>
                  Для ручного выбора macOS нужен доступ к записи экрана. Если его ещё нет, macOS
                  запросит его после нажатия этой кнопки. После выбора передаётся только указанное
                  окно.
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={publishing || disabled}
                onClick={() => choose("manual-window")}
              >
                {manualWindowError ? "Повторить ручной выбор" : "Выбрать окно вручную"}
              </Button>
            </details>
          )}
          {hasPreview && capturesScreen && (
            <p className="screen-share-capture-note" role="note">
              {nativeBridge()?.nativeCapture
                ? share.surface === "monitor"
                  ? "Выбран весь экран. Компонент исключает свой пульт, но другие окна будут видны аудитории. Сверните личные окна и проверьте кадр."
                  : "Браузер не указал тип источника. Другие окна могут быть видны аудитории. Проверьте кадр."
                : share.surface === "monitor"
                  ? "Выбран весь экран. Пульт и другие окна этого экрана будут видны. Для приватного управления установите компонент в настройке проектора или выберите отдельное окно приложения."
                  : "Браузер не указал тип источника. Пульт и другие окна могут быть видны аудитории. Для приватного управления установите компонент в настройке проектора или выберите отдельное окно приложения."}
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
              {capturesScreen && share.surface === "monitor"
                ? "Понимаю, что видны все окна выбранного экрана"
                : share.surface === "unknown"
                  ? "Понимаю, что кадр может содержать другие окна"
                  : nativeSourceKind === "application"
                    ? "Понимаю, что видны окна всего выбранного приложения"
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
              onClick={() => choose("window")}
            >
              {systemPickerTimedOut
                ? "Повторить системный выбор"
                : hasPreview
                  ? "Другой источник"
                  : nativeBridge()?.nativeCapture && systemWindowPickerAvailable
                    ? "Выбрать окно или приложение"
                    : "Выбрать окно или экран"}
            </Button>
            {nativeBridge()?.nativeCapture &&
              nativeBridge()?.captureModes?.protectedDisplay === true &&
              !displayPermissionDenied && (
                <Button
                  variant="outline"
                  disabled={publishing || share.phase === "choosing" || helpersUnknown}
                  title={helperStateTitle}
                  onClick={() => choose("display")}
                >
                  Выбрать весь экран
                </Button>
              )}
            {nativeCapabilities?.nativeCapture &&
              (share.phase === "choosing" || share.phase === "error") && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={publishing}
                  onClick={cancelSourceChoice}
                >
                  Отменить
                </Button>
              )}
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
