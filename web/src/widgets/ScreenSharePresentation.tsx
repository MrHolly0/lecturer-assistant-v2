import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Minus, PictureInPicture2, Play, Plus, RotateCw } from "lucide-react";
import { Button } from "../shared/ui/button";

type Props = {
  stream: MediaStream | null;
  videoUrl?: string | null;
  frameUrl: string | null;
  paused: boolean;
  error: boolean;
  projection?: boolean;
  sourceId?: string | null;
  onRetry: () => void;
  onFrameToChat?: () => void;
  frameToChatPending?: boolean;
  frameToChatMessage?: string;
};

type PresentationVideo = HTMLVideoElement & {
  webkitSetPresentationMode?: (mode: "inline" | "picture-in-picture") => void;
  webkitPresentationMode?: string;
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};
type PresentationDocument = Document & { webkitFullscreenElement?: Element | null };
type Size = { width: number; height: number };

const FALLBACK_SIZE: Size = { width: 16, height: 9 };

export function ScreenSharePresentation({
  stream,
  videoUrl = null,
  frameUrl,
  paused,
  error,
  projection = false,
  sourceId = null,
  onRetry,
  onFrameToChat,
  frameToChatPending = false,
  frameToChatMessage
}: Props) {
  const viewerRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<PresentationVideo>(null);
  const mountedRef = useRef(false);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const sourceRef = useRef({
    identity: null as string | null,
    epoch: 0,
    available: false,
    mediaIdentity: null as MediaStream | string | null
  });
  const lastSourceRef = useRef<{
    identity: string | null;
    mediaIdentity: MediaStream | string | null;
  }>({ identity: null, mediaIdentity: null });
  const [pipActive, setPipActive] = useState(false);
  const [pipMessage, setPipMessage] = useState("");
  const [fullscreenMode, setFullscreenMode] = useState<"native" | "fallback" | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [mediaSize, setMediaSize] = useState(FALLBACK_SIZE);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const nativeFullscreenRef = useRef(false);

  const hasVideo = Boolean(stream || videoUrl);
  const hasImage = !hasVideo && Boolean(frameUrl);
  const sourceAvailable = !paused && !error && (hasVideo || hasImage);
  const sourceIdentity = sourceAvailable
    ? `${sourceId ?? "unkeyed"}:${hasVideo ? "video" : "image"}`
    : null;
  const mediaIdentity: MediaStream | string | null = hasVideo ? stream ?? videoUrl : null;

  if (
    sourceRef.current.identity !== sourceIdentity ||
    sourceRef.current.mediaIdentity !== mediaIdentity
  ) {
    sourceRef.current = {
      identity: sourceIdentity,
      epoch: sourceRef.current.epoch + 1,
      available: sourceAvailable,
      mediaIdentity
    };
  } else {
    sourceRef.current.available = sourceAvailable;
  }

  const fitScale =
    viewport.width > 0 && viewport.height > 0
      ? Math.min(viewport.width / mediaSize.width, viewport.height / mediaSize.height)
      : 1;
  const fittedWidth = Math.max(1, mediaSize.width * fitScale);
  const fittedHeight = Math.max(1, mediaSize.height * fitScale);
  const mediaWidth = Math.max(1, fittedWidth * zoom);
  const mediaHeight = Math.max(1, fittedHeight * zoom);
  const spaceWidth = Math.max(viewport.width, mediaWidth);
  const spaceHeight = Math.max(viewport.height, mediaHeight);

  const syncNativePresentation = useCallback(() => {
    const video = videoRef.current;
    const viewer = viewerRef.current;
    const owner = (viewer?.ownerDocument ?? document) as PresentationDocument;
    const fullscreenElement = owner.fullscreenElement ?? owner.webkitFullscreenElement;
    const fullscreen = Boolean(
      (fullscreenElement && (fullscreenElement === video || fullscreenElement === viewer)) ||
        video?.webkitDisplayingFullscreen ||
        video?.webkitPresentationMode === "fullscreen"
    );
    const pip = Boolean(
      (video && owner.pictureInPictureElement === video) ||
        video?.webkitPresentationMode === "picture-in-picture"
    );
    setPipActive(sourceRef.current.available && pip);
    setFullscreenMode((current) =>
      fullscreen && sourceRef.current.available ? "native" : current === "native" ? null : current
    );
  }, []);

  const closePip = useCallback(
    (updateState = true) => {
      const video = videoRef.current;
      const sync = () => {
        if (updateState && mountedRef.current) syncNativePresentation();
      };
      if (video && document.pictureInPictureElement === video) {
        const exiting = document.exitPictureInPicture?.();
        void exiting?.then(sync, sync);
      }
      try {
        if (video?.webkitPresentationMode === "picture-in-picture") {
          video.webkitSetPresentationMode?.("inline");
        }
      } catch {
        // The browser may already have revoked the presentation surface.
      }
      sync();
    },
    [syncNativePresentation]
  );

  const exitFullscreenFallback = useCallback(() => {
    setFullscreenMode((current) => (current === "fallback" ? null : current));
  }, []);

  const enterFullscreen = () => {
    const video = videoRef.current;
    if (fullscreenMode) {
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(exitFullscreenFallback);
      } else if (fullscreenMode === "fallback") {
        exitFullscreenFallback();
      } else {
        video?.webkitExitFullscreen?.();
        setFullscreenMode(null);
      }
      return;
    }

    const target = hasVideo ? video : viewerRef.current;
    if (!target) return;
    focusReturnRef.current = document.activeElement as HTMLElement | null;
    const expectedEpoch = sourceRef.current.epoch;

    const enterFallback = () => {
      if (
        mountedRef.current &&
        sourceRef.current.available &&
        sourceRef.current.epoch === expectedEpoch
      ) {
        setFullscreenMode("fallback");
      }
    };

    if (hasVideo && video?.webkitEnterFullscreen && !video.requestFullscreen) {
      try {
        video.webkitEnterFullscreen();
        syncNativePresentation();
        return;
      } catch {
        enterFallback();
        return;
      }
    }

    if (typeof target.requestFullscreen !== "function") {
      enterFallback();
      return;
    }

    // Call synchronously from the click to preserve browser user activation.
    try {
      void target.requestFullscreen().then(() => {
        if (
          !mountedRef.current ||
          !sourceRef.current.available ||
          sourceRef.current.epoch !== expectedEpoch
        ) {
          if (document.fullscreenElement === target) {
            const exiting = document.exitFullscreen?.();
            void exiting?.catch(() => undefined);
          }
          return;
        }
        // A native close can happen before this request settles.
        syncNativePresentation();
      }, enterFallback);
    } catch {
      enterFallback();
    }
  };

  const enterPip = () => {
    const video = videoRef.current;
    if (!hasVideo || !sourceAvailable || !video) return;
    if (pipActive) {
      closePip();
      return;
    }
    setPipMessage("");
    const expectedEpoch = sourceRef.current.epoch;
    const unavailable = () => {
      if (
        mountedRef.current &&
        sourceRef.current.available &&
        sourceRef.current.epoch === expectedEpoch
      ) {
        setPipActive(false);
        setPipMessage("Картинка в картинке недоступна в этом браузере.");
      }
    };

    if (video.requestPictureInPicture) {
      try {
        void video.requestPictureInPicture().then(() => {
          if (
            !mountedRef.current ||
            !sourceRef.current.available ||
            sourceRef.current.epoch !== expectedEpoch
          ) {
            if (document.pictureInPictureElement === video) {
              const exiting = document.exitPictureInPicture?.();
              void exiting?.catch(() => undefined);
            }
            return;
          }
          syncNativePresentation();
        }, unavailable);
      } catch {
        unavailable();
      }
      return;
    }

    if (video.webkitSetPresentationMode && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        video.webkitSetPresentationMode("picture-in-picture");
        syncNativePresentation();
        return;
      } catch {
        unavailable();
        return;
      }
    }
    unavailable();
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateSize = () => setViewport({ width: stage.clientWidth, height: stage.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [projection, sourceAvailable]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!sourceAvailable || !hasVideo) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
      return;
    }

    if (stream) {
      video.removeAttribute("src");
      video.srcObject = stream;
    } else {
      video.srcObject = null;
      if (video.src !== videoUrl) video.src = videoUrl ?? "";
    }
    const expectedEpoch = sourceRef.current.epoch;
    void video.play().then(
      () => {
        if (sourceRef.current.available && sourceRef.current.epoch === expectedEpoch) {
          setPlaybackBlocked(false);
        }
      },
      () => {
        if (sourceRef.current.available && sourceRef.current.epoch === expectedEpoch) {
          setPlaybackBlocked(true);
        }
      }
    );
    return () => {
      video.pause();
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [hasVideo, sourceAvailable, stream, videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    const onLeavePip = () => setPipActive(false);
    const onWebkitFullscreenEnd = () => {
      setFullscreenMode((current) => (current === "native" ? null : current));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncNativePresentation();
    };
    video?.addEventListener("enterpictureinpicture", syncNativePresentation);
    video?.addEventListener("leavepictureinpicture", onLeavePip);
    video?.addEventListener("webkitpresentationmodechanged", syncNativePresentation);
    video?.addEventListener("webkitbeginfullscreen", syncNativePresentation);
    video?.addEventListener("webkitendfullscreen", onWebkitFullscreenEnd);
    document.addEventListener("fullscreenchange", syncNativePresentation);
    document.addEventListener("webkitfullscreenchange", syncNativePresentation);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", syncNativePresentation);
    window.addEventListener("focus", syncNativePresentation);
    syncNativePresentation();
    return () => {
      video?.removeEventListener("enterpictureinpicture", syncNativePresentation);
      video?.removeEventListener("leavepictureinpicture", onLeavePip);
      video?.removeEventListener("webkitpresentationmodechanged", syncNativePresentation);
      video?.removeEventListener("webkitbeginfullscreen", syncNativePresentation);
      video?.removeEventListener("webkitendfullscreen", onWebkitFullscreenEnd);
      document.removeEventListener("fullscreenchange", syncNativePresentation);
      document.removeEventListener("webkitfullscreenchange", syncNativePresentation);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", syncNativePresentation);
      window.removeEventListener("focus", syncNativePresentation);
    };
  }, [hasVideo, sourceAvailable, mediaIdentity, syncNativePresentation]);

  useEffect(() => {
    const wasNative = nativeFullscreenRef.current;
    nativeFullscreenRef.current = fullscreenMode === "native";
    if (wasNative && fullscreenMode !== "native") {
      focusReturnRef.current?.focus({ preventScroll: true });
      focusReturnRef.current = null;
    }
  }, [fullscreenMode]);

  useEffect(() => {
    const previous = lastSourceRef.current;
    if (previous.identity !== sourceIdentity || previous.mediaIdentity !== mediaIdentity) {
      if (previous.identity !== null) {
        closePip();
        const target = hasVideo ? videoRef.current : viewerRef.current;
        if (document.fullscreenElement === target) {
          const exiting = document.exitFullscreen?.();
          void exiting?.catch(() => undefined);
        }
        if (hasVideo) videoRef.current?.webkitExitFullscreen?.();
        setFullscreenMode(null);
      }
      setPlaybackBlocked(false);
      lastSourceRef.current = { identity: sourceIdentity, mediaIdentity };
    }
  }, [sourceIdentity, mediaIdentity, hasVideo, closePip]);

  useEffect(() => {
    if (sourceAvailable) return;
    closePip();
    const target = hasVideo ? videoRef.current : viewerRef.current;
    const fullscreenExit =
      document.fullscreenElement === target ? document.exitFullscreen?.() : undefined;
    void fullscreenExit?.catch(() => undefined);
    if (hasVideo) videoRef.current?.webkitExitFullscreen?.();
    setFullscreenMode(null);
    setZoom(1);
  }, [sourceAvailable, hasVideo, closePip]);

  useEffect(() => {
    if (fullscreenMode !== "fallback") return;
    const root = document.documentElement;
    const body = document.body;
    const oldRootOverflow = root.style.overflow;
    const oldBodyOverflow = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    viewerRef.current?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = oldRootOverflow;
      body.style.overflow = oldBodyOverflow;
      const target = focusReturnRef.current;
      focusReturnRef.current = null;
      target?.focus({ preventScroll: true });
    };
  }, [fullscreenMode]);

  useEffect(() => {
    if (fullscreenMode !== "fallback") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitFullscreenFallback();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = viewerRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), video[tabindex="0"], [tabindex="0"]'
      );
      if (!controls?.length) {
        event.preventDefault();
        viewerRef.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      const activeInside = Boolean(viewerRef.current?.contains(document.activeElement));
      if (!activeInside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === viewerRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [fullscreenMode, exitFullscreenFallback]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const video = videoRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closePip(false);
      if (document.fullscreenElement === video || document.fullscreenElement === viewer) {
        const exiting = document.exitFullscreen?.();
        void exiting?.catch(() => undefined);
      }
      video?.webkitExitFullscreen?.();
    };
  }, [closePip]);

  const state = paused ? (
    <div className="screen-share-viewer-state" role="status">
      <strong>Демонстрация на паузе</strong>
      <span>Преподаватель скоро продолжит показ.</span>
    </div>
  ) : error ? (
    <div className="screen-share-viewer-state" role="status">
      <strong>Не удалось получить демонстрацию</strong>
      <span>Проверьте подключение и повторите попытку.</span>
      {!projection && (
        <Button type="button" variant="outline" onClick={onRetry}>
          <RotateCw size={17} aria-hidden="true" /> Повторить
        </Button>
      )}
    </div>
  ) : !sourceAvailable ? (
    <div className="screen-share-viewer-state" role="status">
      <strong>Подключаем демонстрацию…</strong>
    </div>
  ) : null;

  const className = [
    "screen-share-viewer",
    "screen-share-presentation",
    projection && "screen-share-viewer--projection",
    fullscreenMode === "fallback" && "screen-share-viewer--fullscreen-fallback"
  ]
    .filter(Boolean)
    .join(" ");

  const fitImage = hasImage && zoom === 1;
  const syncMsePlayback = (video: HTMLVideoElement) => {
    if (!videoUrl || video.buffered.length < 1) return;
    const first = video.buffered.start(0);
    const lastIndex = video.buffered.length - 1;
    const last = video.buffered.end(lastIndex);
    if (video.currentTime < first - 0.1) {
      video.currentTime = first + 0.02;
    } else if (Number.isFinite(last) && last - video.currentTime > 5) {
      video.currentTime = Math.max(first, last - 0.5);
    }
  };

  return (
    <section
      ref={viewerRef}
      className={className}
      aria-label="Демонстрация преподавателя"
      role={fullscreenMode === "fallback" ? "dialog" : undefined}
      aria-modal={fullscreenMode === "fallback" ? true : undefined}
      tabIndex={fullscreenMode === "fallback" ? -1 : undefined}
    >
      {!projection && (
        <div className="screen-share-presentation__heading">Демонстрация преподавателя</div>
      )}
      <div
        ref={stageRef}
        className={`screen-share-presentation__stage${fitImage ? " screen-share-presentation__stage--image" : ""}`}
        tabIndex={sourceAvailable ? 0 : undefined}
        aria-label="Область демонстрации преподавателя"
      >
        {state}
        {sourceAvailable && hasVideo && (
          <div
            className="screen-share-presentation__space"
            style={{ width: spaceWidth, height: spaceHeight }}
          >
            <video
              ref={videoRef}
              className="screen-share-presentation__media"
              autoPlay
              controls
              muted
              playsInline
              disableRemotePlayback
              aria-label="Демонстрация преподавателя"
              onPlay={() => setPlaybackBlocked(false)}
              onProgress={(event) => syncMsePlayback(event.currentTarget)}
              onCanPlay={(event) => syncMsePlayback(event.currentTarget)}
              onLoadedMetadata={(event) =>
                setMediaSize({
                  width: event.currentTarget.videoWidth || 16,
                  height: event.currentTarget.videoHeight || 9
                })
              }
              style={{ width: mediaWidth, height: mediaHeight }}
            />
          </div>
        )}
        {sourceAvailable && hasImage && frameUrl && (
          <div
            className="screen-share-presentation__space"
            style={{ width: spaceWidth, height: spaceHeight }}
          >
            <img
              className="screen-share-presentation__media"
              src={frameUrl}
              alt="Покадровый показ — соединение нестабильно"
              draggable={false}
              onLoad={(event) =>
                setMediaSize({
                  width: event.currentTarget.naturalWidth || 16,
                  height: event.currentTarget.naturalHeight || 9
                })
              }
              style={{ width: mediaWidth, height: mediaHeight }}
            />
          </div>
        )}
      </div>

      {!projection && sourceAvailable && (
        <div className="screen-share-presentation__toolbar" aria-label="Управление демонстрацией">
          {hasVideo && playbackBlocked && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const expectedEpoch = sourceRef.current.epoch;
                const playRequest = videoRef.current?.play();
                void playRequest?.then(
                  () => {
                    if (sourceRef.current.available && sourceRef.current.epoch === expectedEpoch) {
                      setPlaybackBlocked(false);
                    }
                  },
                  () => {
                    if (sourceRef.current.available && sourceRef.current.epoch === expectedEpoch) {
                      setPlaybackBlocked(true);
                    }
                  }
                );
              }}
            >
              <Play size={17} aria-hidden="true" /> Воспроизвести видео
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            aria-label={fullscreenMode ? "Выйти из полноэкранного режима" : "На весь экран"}
            aria-pressed={Boolean(fullscreenMode)}
            onClick={enterFullscreen}
          >
            {fullscreenMode ? (
              <Minimize2 size={17} aria-hidden="true" />
            ) : (
              <Maximize2 size={17} aria-hidden="true" />
            )}
            {fullscreenMode ? "Свернуть экран" : "На весь экран"}
          </Button>
          {hasVideo ? (
            <Button
              type="button"
              variant="outline"
              aria-label={pipActive ? "Закрыть картинку в картинке" : "Картинка в картинке"}
              aria-pressed={pipActive}
              onClick={enterPip}
            >
              <PictureInPicture2 size={17} aria-hidden="true" />
              {pipActive ? "Вернуть показ" : "Картинка в картинке"}
            </Button>
          ) : (
            <span className="screen-share-presentation__image-mode">
              Покадровый показ — соединение нестабильно
            </span>
          )}
          {hasImage && (
            <div
              className="screen-share-presentation__zoom"
              role="group"
              aria-label="Масштаб кадра"
            >
              <button
                type="button"
                aria-label="Уменьшить масштаб"
                disabled={zoom <= 1}
                onClick={() =>
                  setZoom((value) => Math.max(1, Math.round((value - 0.25) * 100) / 100))
                }
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <label className="screen-share-presentation__range-label">
                <span>{zoom.toFixed(2).replace(/\.00$/, "")} ×</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.25}
                  value={zoom}
                  aria-label="Масштаб кадра от 1 до 4"
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                aria-label="Увеличить масштаб"
                disabled={zoom >= 4}
                onClick={() =>
                  setZoom((value) => Math.min(4, Math.round((value + 0.25) * 100) / 100))
                }
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              <Button type="button" variant="ghost" onClick={() => setZoom(1)}>
                <Minimize2 size={15} aria-hidden="true" /> Вписать
              </Button>
            </div>
          )}
          {hasImage && onFrameToChat && (
            <div className="screen-share-presentation__frame-action">
              <Button
                type="button"
                variant="outline"
                onClick={onFrameToChat}
                disabled={frameToChatPending}
              >
                {frameToChatPending ? "Отправляем кадр…" : "Получить кадр в MAX"}
              </Button>
              {frameToChatMessage && <span role="status">{frameToChatMessage}</span>}
            </div>
          )}
          {pipMessage && (
            <span className="screen-share-presentation__feedback" role="status">
              {pipMessage}
            </span>
          )}
          {fullscreenMode === "fallback" && (
            <span className="screen-share-presentation__escape-hint">Esc — выйти</span>
          )}
        </div>
      )}
    </section>
  );
}
