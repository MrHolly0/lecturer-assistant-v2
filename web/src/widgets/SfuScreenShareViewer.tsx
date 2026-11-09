import { useEffect, useState, useRef } from "react";
import type { Room } from "livekit-client";
import { viewerSfuTicket } from "../app/api/share-api";
import { retryDelayMs, isRetryableError } from "../app/api/retry";
import { ScreenSharePresentation } from "./ScreenSharePresentation";
import type { ScreenShareViewerProps } from "./ScreenShareViewer";

export function SfuScreenShareViewer({
  joinCode,
  participantToken = "",
  projectionViewToken,
  paused = false,
  children
}: ScreenShareViewerProps) {
  const [state, setState] = useState({
    active: false,
    paused: false,
    error: false,
    sourceId: null as string | null,
    stream: null as MediaStream | null
  });
  const [retry, setRetry] = useState(0);
  const viewer = useRef(crypto.randomUUID());
  useEffect(() => {
    let alive = true,
      room: Room | null = null,
      sourceId: string | null = null,
      failures = 0,
      polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const disconnect = () => {
      const previous = room;
      room = null;
      previous?.removeAllListeners();
      if (previous) void previous.disconnect();
    };
    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      if (alive) timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (!alive || polling) return;
      polling = true;
      let delay = 3000 + Math.random() * 2000;
      try {
        const response = await viewerSfuTicket(
          joinCode,
          viewer.current,
          participantToken,
          projectionViewToken,
          AbortSignal.any([abort.signal, AbortSignal.timeout(5000)])
        );
        if (!alive) return;
        if (!response) {
          disconnect();
          sourceId = null;
          setState({ active: false, paused: false, error: false, sourceId: null, stream: null });
        } else if (response.paused) {
          disconnect();
          sourceId = response.id;
          setState({ active: true, paused: true, error: false, sourceId, stream: null });
        } else if (response.ticket) {
          delay = 20000 + Math.random() * 10000;
          if (sourceId !== response.id || !room || room.state === "disconnected") {
            const { Room, RoomEvent, Track } = await import("livekit-client");
            if (!alive) return;
            disconnect();
            sourceId = response.id;
            const current = new Room({ adaptiveStream: false, dynacast: false });
            room = current;
            setState({ active: true, paused: false, error: false, sourceId, stream: null });
            current.on(RoomEvent.TrackSubscribed, (track) => {
              if (alive && room === current && track.kind === Track.Kind.Video)
                setState((s) => ({
                  ...s,
                  stream: new MediaStream([track.mediaStreamTrack]),
                  error: false
                }));
            });
            current.on(RoomEvent.TrackUnsubscribed, (track) => {
              if (alive && room === current && track.kind === Track.Kind.Video)
                setState((s) => ({ ...s, stream: null }));
            });
            current.on(RoomEvent.Disconnected, () => {
              if (alive && room === current) {
                setState((s) => ({ ...s, stream: null, error: true }));
                schedule(retryDelayMs(failures++, { baseMs: 2000, maxMs: 30000 }));
              }
            });
            await current.connect(response.ticket.url, response.ticket.token, {
              autoSubscribe: true
            });
            if (!alive || room !== current) await current.disconnect();
          }
        }
        failures = 0;
      } catch (error) {
        if (!alive) return;
        if (!isRetryableError(error)) {
          disconnect();
          setState((s) => ({ ...s, stream: null, error: s.active }));
          return;
        }
        if (!room || room.state === "disconnected")
          setState((s) => ({ ...s, stream: null, error: s.active }));
        delay = retryDelayMs(failures++, { baseMs: 3000, maxMs: 30000, error });
      } finally {
        polling = false;
      }
      schedule(delay);
    };
    void poll();
    return () => {
      alive = false;
      abort.abort();
      if (timer) clearTimeout(timer);
      disconnect();
    };
  }, [joinCode, participantToken, projectionViewToken, retry]);
  if (!state.active) return <>{children}</>;
  return (
    <ScreenSharePresentation
      stream={state.stream}
      frameUrl={null}
      sourceId={state.sourceId}
      paused={paused || state.paused}
      error={state.error}
      projection={Boolean(projectionViewToken)}
      onRetry={() => setRetry((value) => value + 1)}
    />
  );
}
