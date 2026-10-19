import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { ShareVideoPlayback } from "../app/sharing/videoPlayback";
import { ScreenSharePresentation } from "./ScreenSharePresentation";

export function ScreenShareViewer({
  joinCode,
  participantToken = "",
  local = false,
  localChannelId,
  projectionViewToken,
  paused = false,
  onFrameToChat,
  frameToChatPending,
  frameToChatMessage,
  children
}: {
  joinCode: string;
  participantToken?: string;
  local?: boolean;
  localChannelId?: string | null;
  projectionViewToken?: string | null;
  paused?: boolean;
  onFrameToChat?: () => void;
  frameToChatPending?: boolean;
  frameToChatMessage?: string;
  children: ReactNode;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [rtcConnected, setRtcConnected] = useState(false);
  const [active, setActive] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [mediaPaused, setMediaPaused] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const recoveryAttempt = useRef(0);
  useEffect(() => {
    let alive = true,
      busy = false,
      frameBusy = false,
      remoteAvailable = false;
    let peer: RTCPeerConnection | null = null;
    let videoPlayback: ShareVideoPlayback | null = null;
    let shareId: string | null = null;
    let roomId: string | null = null;
    let lastStatus = 0,
      activeSince = 0,
      lastFrame = 0;
    let roomPaused = false;
    let halted = false;
    let retryable = true;
    let generation = 0;
    let statusAbort: AbortController | null = null;
    let frameAbort: AbortController | null = null;
    let answerAbort: AbortController | null = null;
    let frameObjectUrl: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frameExpiry: ReturnType<typeof setTimeout> | null = null;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    const viewerId = crypto.randomUUID();
    const localMode = local && !projectionViewToken;
    if (localMode && !localChannelId) {
      setActive(false);
      setSourceId(null);
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
    const clearVideo = () => {
      videoPlayback?.stop();
      videoPlayback = null;
      if (alive) setVideoUrl(null);
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
      clearVideo();
      clearFrame();
      roomId = null;
      activeSince = 0;
      lastFrame = 0;
      if (alive) {
        setActive(false);
        setSourceId(null);
        setError(false);
      }
    };
    const scheduleRecovery = () => {
      if (
        !alive ||
        !halted ||
        !retryable ||
        recoveryTimer ||
        document.visibilityState === "hidden" ||
        !navigator.onLine
      )
        return;
      const delay = Math.min(1500 * 2 ** recoveryAttempt.current++, 15000);
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        if (alive && navigator.onLine && document.visibilityState !== "hidden")
          setRetry((value) => value + 1);
      }, delay);
    };
    const halt = (recoverable = true) => {
      if (!alive || halted) return;
      halted = true;
      retryable = recoverable;
      generation += 1;
      statusAbort?.abort();
      frameAbort?.abort();
      answerAbort?.abort();
      if (timer) clearTimeout(timer);
      dropPeer();
      clearVideo();
      clearFrame();
      roomId = null;
      activeSince = 0;
      setActive(true);
      setSourceId(null);
      setMediaPaused(false);
      setError(true);
      scheduleRecovery();
    };
    const acceptStatus = (id: string, nextPaused: boolean) => {
      if (!alive || halted) return;
      if (roomId !== id) {
        reset();
        roomId = id;
        activeSince = Date.now();
      }
      roomPaused = nextPaused;
      recoveryAttempt.current = 0;
      setSourceId(id);
      lastStatus = Date.now();
      if (nextPaused) {
        clearFrame();
        clearVideo();
      }
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
          clearVideo();
          setError(false);
        } else if (
          ["failed", "disconnected"].includes(next.connectionState) &&
          !videoPlayback?.isReady() &&
          !frameObjectUrl
        )
          setError(true);
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
          if (!videoPlayback?.isReady() && !frameObjectUrl) setError(true);
          if (failure instanceof ApiError && [401, 403, 404, 410].includes(failure.status)) {
            halt(false);
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
          if (revoked) halt(false);
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
        videoPlayback?.isReady() ||
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
          halt(false);
      } finally {
        clearTimeout(deadline);
        if (frameAbort === controller) frameAbort = null;
        frameBusy = false;
      }
    };
    const videoTick = () => {
      if (!alive || halted || channel || !roomId || roomPaused || connected()) {
        clearVideo();
        return;
      }
      if (!videoPlayback) {
        videoPlayback = new ShareVideoPlayback(
          { code: joinCode, viewerId, participantToken, projectionViewToken },
          roomId,
          {
            onUrl: (url) => {
              if (alive && !halted) {
                setVideoUrl(url);
                if (url) setError(false);
              }
            },
            onFailure: (failure) => {
              if (failure instanceof ApiError && [401, 403].includes(failure.status)) halt(false);
            }
          }
        );
      }
      void videoPlayback.refresh();
    };
    // This lease check must keep running while a status fetch, answer, or ICE is stuck.
    const livenessTimer = setInterval(() => {
      if (alive && !halted && roomId && lastStatus && Date.now() - lastStatus >= 4000) halt();
    }, 250);
    const frameTimer = setInterval(() => void frameTick(), 800);
    const videoTimer = setInterval(videoTick, 500);
    const resume = () => {
      if (!alive || document.visibilityState === "hidden" || !navigator.onLine || !retryable)
        return;
      if (halted) {
        scheduleRecovery();
      } else if (lastStatus && Date.now() - lastStatus >= 4000) {
        // A suspended WebView cannot renew media leases. Discard its old media and
        // verify the existing participant again; a transport timeout is not logout.
        recoveryAttempt.current = 0;
        halt();
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    setActive(false);
    setSourceId(null);
    setStream(null);
    setFrameUrl(null);
    setVideoUrl(null);
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
      if (recoveryTimer) clearTimeout(recoveryTimer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      clearInterval(livenessTimer);
      clearInterval(frameTimer);
      clearInterval(videoTimer);
      videoPlayback?.stop();
      peer?.close();
      clearFrame();
      channel?.postMessage({ type: "leave", viewerId });
      channel?.close();
    };
  }, [joinCode, participantToken, local, localChannelId, projectionViewToken, retry]);
  if (!active) return <>{children}</>;
  return (
    <ScreenSharePresentation
      stream={rtcConnected ? stream : null}
      videoUrl={videoUrl}
      sourceId={sourceId}
      frameUrl={frameUrl}
      paused={paused || mediaPaused}
      error={error}
      projection={local || Boolean(projectionViewToken)}
      onRetry={() => setRetry((value) => value + 1)}
      onFrameToChat={onFrameToChat}
      frameToChatPending={frameToChatPending}
      frameToChatMessage={frameToChatMessage}
    />
  );
}
