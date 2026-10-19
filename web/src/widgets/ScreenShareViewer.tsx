import { useEffect, useRef, useState, type ReactNode } from "react";
import { CirclePause, Monitor, RotateCw } from "lucide-react";
import {
  answerProjectionShare,
  answerShare,
  getProjectionShareFrame,
  getShareFrame,
  viewProjectionShare,
  viewShare
} from "../app/api/share-api";
import { ApiError } from "../app/api/http";
import { gatheredDescription, localShareChannel } from "../app/sharing/rtc";
import { Button } from "../shared/ui/button";

export function ScreenShareViewer({
  joinCode,
  participantToken = "",
  local = false,
  localChannelId,
  projectionViewToken,
  paused = false,
  children
}: {
  joinCode: string;
  participantToken?: string;
  local?: boolean;
  localChannelId?: string | null;
  projectionViewToken?: string | null;
  paused?: boolean;
  children: ReactNode;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [rtcConnected, setRtcConnected] = useState(false);
  const [active, setActive] = useState(false);
  const [mediaPaused, setMediaPaused] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let alive = true,
      busy = false,
      frameBusy = false,
      remoteAvailable = false;
    let peer: RTCPeerConnection | null = null;
    let shareId: string | null = null;
    let roomId: string | null = null;
    let lastStatus = 0,
      activeSince = 0,
      lastFrame = 0;
    let roomPaused = false;
    let halted = false;
    let generation = 0;
    let statusAbort: AbortController | null = null;
    let frameAbort: AbortController | null = null;
    let answerAbort: AbortController | null = null;
    let frameObjectUrl: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frameExpiry: ReturnType<typeof setTimeout> | null = null;
    const viewerId = crypto.randomUUID();
    const localMode = local && !projectionViewToken;
    if (localMode && !localChannelId) {
      setActive(false);
      setStream(null);
      setFrameUrl(null);
      return;
    }
    const channel = localMode ? localShareChannel(joinCode, localChannelId!) : null;
    const clearFrame = () => {
      if (frameExpiry) clearTimeout(frameExpiry);
      frameExpiry = null;
      if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl);
      frameObjectUrl = null;
      if (alive) setFrameUrl(null);
    };
    const connected = () => remoteAvailable && peer?.connectionState === "connected";
    const acceptFrame = (blob: Blob) => {
      if (
        !alive ||
        halted ||
        roomPaused ||
        connected() ||
        !activeSince ||
        Date.now() - activeSince < 4000
      )
        return;
      if (!blob.size || blob.size > 524288 || blob.type !== "image/jpeg") return;
      const previous = frameObjectUrl;
      frameObjectUrl = URL.createObjectURL(blob);
      lastFrame = Date.now();
      if (frameExpiry) clearTimeout(frameExpiry);
      frameExpiry = setTimeout(clearFrame, 4000);
      setFrameUrl(frameObjectUrl);
      setError(false);
      if (previous) URL.revokeObjectURL(previous);
    };
    const dropPeer = () => {
      peer?.close();
      peer = null;
      shareId = null;
      remoteAvailable = false;
      if (alive) {
        setStream(null);
        setRtcConnected(false);
      }
    };
    const reset = () => {
      dropPeer();
      clearFrame();
      roomId = null;
      activeSince = 0;
      lastFrame = 0;
      if (alive) {
        setActive(false);
        setError(false);
      }
    };
    const halt = () => {
      if (!alive || halted) return;
      halted = true;
      generation += 1;
      statusAbort?.abort();
      frameAbort?.abort();
      answerAbort?.abort();
      if (timer) clearTimeout(timer);
      dropPeer();
      clearFrame();
      roomId = null;
      activeSince = 0;
      setActive(true);
      setMediaPaused(false);
      setError(true);
    };
    const acceptStatus = (id: string, nextPaused: boolean) => {
      if (!alive || halted) return;
      if (roomId !== id) {
        reset();
        roomId = id;
        activeSince = Date.now();
      }
      roomPaused = nextPaused;
      lastStatus = Date.now();
      if (nextPaused) clearFrame();
      setActive(true);
      setMediaPaused(nextPaused);
    };
    const receiveOffer = async (id: string, sdp: string, iceServers: RTCIceServer[]) => {
      if (!alive || halted || busy || (shareId === id && peer)) return;
      const requestGeneration = generation;
      const controller = new AbortController();
      answerAbort?.abort();
      answerAbort = controller;
      busy = true;
      dropPeer();
      const next = new RTCPeerConnection({ iceServers });
      peer = next;
      shareId = id;
      next.ontrack = (event) => {
        if (alive && peer === next) {
          remoteAvailable = true;
          setStream(event.streams[0] ?? new MediaStream([event.track]));
          setRtcConnected(next.connectionState === "connected");
          setError(false);
        }
      };
      next.onconnectionstatechange = () => {
        if (!alive || halted || generation !== requestGeneration || peer !== next) return;
        const ready = connected();
        setRtcConnected(ready);
        if (ready) {
          clearFrame();
          setError(false);
        } else if (["failed", "disconnected"].includes(next.connectionState)) setError(true);
      };
      try {
        await next.setRemoteDescription({ type: "offer", sdp });
        if (!alive || halted || generation !== requestGeneration || peer !== next) return;
        await next.setLocalDescription(await next.createAnswer());
        const answer = await gatheredDescription(next);
        if (!alive || halted || generation !== requestGeneration || peer !== next) return;
        if (channel) channel.postMessage({ type: "answer", viewerId, shareId: id, sdp: answer });
        else if (projectionViewToken)
          await answerProjectionShare(
            joinCode,
            viewerId,
            projectionViewToken,
            id,
            answer,
            controller.signal
          );
        else await answerShare(joinCode, viewerId, participantToken, id, answer, controller.signal);
      } catch (failure) {
        if (alive && !halted && generation === requestGeneration && peer === next) {
          setError(true);
          if (failure instanceof ApiError && [401, 403, 404, 410].includes(failure.status)) {
            halt();
          }
        }
      } finally {
        if (answerAbort === controller) answerAbort = null;
        busy = false;
      }
    };
    if (channel)
      channel.onmessage = (event: MessageEvent) => {
        const value = event.data as Record<string, unknown>;
        if (!alive || halted || !value || typeof value !== "object") return;
        if (value.type === "stop") {
          reset();
          return;
        }
        if (value.type === "status" && typeof value.shareId === "string")
          acceptStatus(value.shareId, Boolean(value.paused));
        if (value.type === "frame" && value.shareId === roomId && value.frame instanceof Blob)
          acceptFrame(value.frame);
        if (
          value.type === "offer" &&
          value.viewerId === viewerId &&
          value.shareId === roomId &&
          typeof value.sdp === "string" &&
          value.sdp.length <= 65536
        )
          void receiveOffer(String(value.shareId), value.sdp, []);
      };
    const poll = async () => {
      if (!alive || halted) return;
      const requestGeneration = generation;
      const controller = new AbortController();
      statusAbort = controller;
      const deadline = setTimeout(() => {
        controller.abort();
        if (alive && !halted && generation === requestGeneration) halt();
      }, 4000);
      try {
        if (channel) {
          channel.postMessage({ type: "request", viewerId });
        } else {
          const status = projectionViewToken
            ? await viewProjectionShare(joinCode, viewerId, projectionViewToken, controller.signal)
            : await viewShare(joinCode, viewerId, participantToken, controller.signal);
          if (!alive || halted || controller.signal.aborted || generation !== requestGeneration)
            return;
          if (!status) reset();
          else {
            acceptStatus(status.id, status.paused);
            if (status.offer) void receiveOffer(status.id, status.offer, status.iceServers);
          }
        }
      } catch (failure) {
        if (alive && !halted && generation === requestGeneration) {
          const revoked =
            failure instanceof ApiError && [401, 403, 404, 410].includes(failure.status);
          if (lastStatus || projectionViewToken) {
            setActive(true);
            setError(true);
          }
          if (revoked) halt();
        }
      } finally {
        clearTimeout(deadline);
        if (statusAbort === controller) statusAbort = null;
      }
      if (alive && !halted) timer = setTimeout(() => void poll(), 1500);
    };
    const frameTick = async () => {
      if (frameObjectUrl && Date.now() - lastFrame > 4000) clearFrame();
      if (
        !alive ||
        halted ||
        channel ||
        frameBusy ||
        !roomId ||
        roomPaused ||
        connected() ||
        !activeSince ||
        Date.now() - activeSince < 4000
      )
        return;
      frameBusy = true;
      const requestRoom = roomId;
      const requestGeneration = generation;
      const controller = new AbortController();
      frameAbort = controller;
      const deadline = setTimeout(() => controller.abort(), 4000);
      try {
        const frame = projectionViewToken
          ? await getProjectionShareFrame(
              joinCode,
              viewerId,
              projectionViewToken,
              controller.signal
            )
          : await getShareFrame(joinCode, viewerId, participantToken, controller.signal);
        if (
          alive &&
          !halted &&
          !controller.signal.aborted &&
          generation === requestGeneration &&
          roomId === requestRoom &&
          frame
        )
          acceptFrame(frame);
      } catch (failure) {
        if (
          alive &&
          !halted &&
          generation === requestGeneration &&
          roomId === requestRoom &&
          failure instanceof ApiError &&
          [401, 403, 404, 410].includes(failure.status)
        )
          halt();
      } finally {
        clearTimeout(deadline);
        if (frameAbort === controller) frameAbort = null;
        frameBusy = false;
      }
    };
    // This lease check must keep running while a status fetch, answer, or ICE is stuck.
    const livenessTimer = setInterval(() => {
      if (alive && !halted && roomId && lastStatus && Date.now() - lastStatus >= 4000) halt();
    }, 250);
    const frameTimer = setInterval(() => void frameTick(), 800);
    setActive(false);
    setStream(null);
    setFrameUrl(null);
    setRtcConnected(false);
    setError(false);
    void poll();
    return () => {
      alive = false;
      generation += 1;
      statusAbort?.abort();
      frameAbort?.abort();
      answerAbort?.abort();
      if (timer) clearTimeout(timer);
      clearInterval(livenessTimer);
      clearInterval(frameTimer);
      peer?.close();
      clearFrame();
      channel?.postMessage({ type: "leave", viewerId });
      channel?.close();
    };
  }, [joinCode, participantToken, local, localChannelId, projectionViewToken, retry]);
  useEffect(() => {
    const element = video.current;
    if (!element || !stream || !rtcConnected) return;
    element.srcObject = stream;
    void element.play().catch(() => setError(true));
    return () => {
      element.srcObject = null;
    };
  }, [stream, active, rtcConnected]);
  if (!active) return <>{children}</>;
  const videoReady = Boolean(stream && rtcConnected);
  const hasImage = Boolean(frameUrl || videoReady);
  return (
    <section
      className={`screen-share-viewer${local ? " screen-share-viewer--projection" : ""}`}
      aria-label="Демонстрация преподавателя"
    >
      {videoReady && (
        <video ref={video} autoPlay muted playsInline aria-label="Окно преподавателя" />
      )}
      {!videoReady && frameUrl && (
        <>
          <img src={frameUrl} alt="Демонстрация преподавателя" />
          <span className="screen-share-fallback-label">Обновляемое изображение</span>
        </>
      )}
      {(paused || mediaPaused || !hasImage) && (
        <div className="screen-share-viewer-state" role="status">
          {paused || mediaPaused ? (
            <>
              <CirclePause size={32} aria-hidden="true" />
              <strong>Демонстрация на паузе</strong>
            </>
          ) : error ? (
            <>
              <Monitor size={32} aria-hidden="true" />
              <strong>Не удалось получить демонстрацию</strong>
              <p>Проверьте сеть. Слайды занятия доступны после остановки демонстрации.</p>
              <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
                <RotateCw size={18} aria-hidden="true" />
                Подключиться снова
              </Button>
            </>
          ) : (
            <>
              <Monitor size={32} aria-hidden="true" />
              <strong>Подключаем демонстрацию…</strong>
            </>
          )}
        </div>
      )}
    </section>
  );
}
