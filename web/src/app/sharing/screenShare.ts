import { bindPublicProjection, browserProjection } from "../projection/browserProjection";
import { ApiError } from "../api/http";
import {
  startShare,
  pollShare,
  offerShare,
  stopShare,
  uploadShareFrame,
  type ShareStatus
} from "../api/share-api";
import {
  captureOptions,
  captureSurface,
  validateCaptureSurface,
  type CaptureSurface
} from "./capturePolicy";
import { gatheredDescription, localShareChannel } from "./rtc";
import { ShareVideoPublisher } from "./videoPublisher";

type Scope = { courseId: string; sessionId: string; joinCode: string };
type ShareSource = { stream: MediaStream; sourceName: string; surface: CaptureSurface };
export type ShareSnapshot = {
  phase: "idle" | "choosing" | "preview" | "publishing" | "error";
  stream: MediaStream | null;
  sourceName: string;
  surface: CaptureSurface;
  error: string | null;
  paused: boolean;
  viewers: number;
  scope: Scope | null;
  localChannelId: string | null;
  choosing: boolean;
  pendingSource: ShareSource | null;
};
class ScreenShare {
  private state: ShareSnapshot = {
    phase: "idle",
    stream: null,
    sourceName: "",
    surface: "unknown",
    error: null,
    paused: false,
    viewers: 0,
    scope: null,
    localChannelId: null,
    choosing: false,
    pendingSource: null
  };
  private listeners = new Set<() => void>();
  private peers = new Map<string, RTCPeerConnection>();
  private localPeers = new Map<string, number>();
  private channel: BroadcastChannel | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private share: ShareStatus | null = null;
  private generation = 0;
  private selectionGeneration = 0;
  private publishGeneration: number | null = null;
  private detachProjectionListener: (() => boolean) | null = null;
  private frameVideo: HTMLVideoElement | null = null;
  private frameCanvas: HTMLCanvasElement | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private frameAbort: AbortController | null = null;
  private videoPublisher: ShareVideoPublisher | null = null;
  private videoRetry: ReturnType<typeof setTimeout> | null = null;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<ShareSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async choose(scope: Scope) {
    if (this.state.choosing || this.publishGeneration !== null) return;
    const replacing = this.state.phase === "publishing";
    if (replacing && this.state.scope?.sessionId !== scope.sessionId) return;
    if (replacing) this.cancelSelection();
    else void this.stop();
    const generation = this.generation;
    const selection = ++this.selectionGeneration;
    this.update({
      ...(replacing ? {} : { phase: "choosing" as const, scope }),
      choosing: true,
      error: null
    });
    try {
      if (!navigator.mediaDevices?.getDisplayMedia)
        throw new Error("Откройте сайт в настольном браузере с поддержкой демонстрации экрана.");
      const stream = await navigator.mediaDevices.getDisplayMedia(captureOptions);
      if (generation !== this.generation || selection !== this.selectionGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      const error = validateCaptureSurface(track?.getSettings() ?? {});
      if (error || !track) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(error ?? "Источник не найден");
      }
      track.addEventListener(
        "ended",
        () => {
          if (this.state.pendingSource?.stream === stream) this.cancelSelection();
          else if (this.state.stream === stream) void this.stop();
        },
        { once: true }
      );
      track.addEventListener(
        "mute",
        () => {
          if (this.state.pendingSource?.stream === stream) this.cancelSelection();
          else if (this.state.stream === stream)
            void this.fail("Источник демонстрации недоступен. Выберите окно снова.");
        },
        { once: true }
      );
      const surface = captureSurface(track.getSettings());
      if ("contentHint" in track) track.contentHint = "detail";
      const names = {
        monitor: "Экран преподавателя",
        window: "Окно преподавателя",
        browser: "Вкладка преподавателя",
        unknown: "Демонстрация преподавателя"
      };
      const source = { stream, surface, sourceName: names[surface] };
      this.update(replacing ? { pendingSource: source } : { phase: "preview", ...source });
    } catch (error) {
      if (generation !== this.generation || selection !== this.selectionGeneration) return;
      this.update({
        ...(replacing ? {} : { phase: "error" as const, stream: null }),
        error:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? replacing
              ? null
              : "Выбор отменён. Вы можете выбрать источник снова."
            : error instanceof Error
              ? error.message
              : "Не удалось начать захват."
      });
    } finally {
      if (selection === this.selectionGeneration) this.update({ choosing: false });
    }
  }
  cancelSelection() {
    ++this.selectionGeneration;
    this.state.pendingSource?.stream.getTracks().forEach((track) => track.stop());
    this.update({ pendingSource: null, choosing: false, error: null });
  }
  async publish(): Promise<void> {
    const candidate = this.state.pendingSource;
    if (candidate && this.state.phase === "publishing" && this.state.scope) {
      const scope = this.state.scope;
      // Keep the old source live throughout selection and preview. Switch only on confirmation.
      this.update({ pendingSource: null });
      const stopping = this.stop();
      const generation = this.generation;
      this.update({ phase: "preview", scope, ...candidate });
      await stopping;
      if (generation !== this.generation || this.state.stream !== candidate.stream) return;
      return this.publish();
    }
    const { stream, scope } = this.state;
    if (
      this.state.phase !== "preview" ||
      !stream ||
      !scope ||
      this.share ||
      this.publishGeneration === this.generation
    )
      return;
    const generation = this.generation;
    this.publishGeneration = generation;
    try {
      const share = await startShare(scope.courseId, scope.sessionId, this.state.sourceName);
      if (generation !== this.generation) {
        void stopShare(scope.courseId, scope.sessionId, share.id);
        return;
      }
      this.share = share;
      this.update({ phase: "publishing", error: null });
      const connectLocalProjection = () => {
        const localChannelId =
          browserProjection.getSnapshot().attemptId ??
          this.state.localChannelId ??
          crypto.randomUUID();
        if (localChannelId === this.state.localChannelId && this.channel) return;
        this.channel?.postMessage({ type: "stop" });
        this.channel?.close();
        for (const id of this.localPeers.keys()) {
          this.peers.get(id)?.close();
          this.peers.delete(id);
        }
        this.localPeers.clear();
        this.update({ localChannelId });
        bindPublicProjection(scope.joinCode, localChannelId);
        this.channel = localShareChannel(scope.joinCode, localChannelId);
        this.channel.onmessage = (event: MessageEvent) =>
          void this.localMessage(event.data, generation).catch(() => undefined);
      };
      connectLocalProjection();
      this.detachProjectionListener = browserProjection.subscribe(connectLocalProjection);
      this.sendLocalStatus();
      window.addEventListener("pagehide", this.pagehide);
      this.watchdog = setInterval(() => {
        for (const [id, seen] of this.localPeers)
          if (Date.now() - seen > 8000) {
            this.peers.get(id)?.close();
            this.peers.delete(id);
            this.localPeers.delete(id);
          }
        if (!this.share || Date.parse(this.share.leaseUntil) <= Date.now())
          void this.fail("Связь с сервером потеряна. Демонстрация остановлена.");
        else this.sendLocalStatus();
      }, 1000);
      void this.poll(generation);
      void this.startFrames(generation);
      this.startVideo(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({
        error: error instanceof Error ? error.message : "Не удалось начать демонстрацию."
      });
    } finally {
      if (this.publishGeneration === generation) this.publishGeneration = null;
    }
  }
  private async poll(generation: number) {
    const { scope } = this.state;
    if (!scope || !this.share || generation !== this.generation) return;
    try {
      const share = await pollShare(scope.courseId, scope.sessionId, this.share.id);
      if (generation !== this.generation) return;
      this.share = share;
      this.setPaused(share.paused);
      const ids = new Set(share.peers.map((item) => item.id));
      for (const [id, peer] of this.peers)
        if (!this.localPeers.has(id) && !ids.has(id)) {
          peer.close();
          this.peers.delete(id);
        }
      for (const viewer of share.peers) {
        let peer = this.peers.get(viewer.id);
        if (!peer) {
          peer = this.newPeer(viewer.id, share.iceServers);
          const current = peer;
          void (async () => {
            await current.setLocalDescription(await current.createOffer());
            const sdp = await gatheredDescription(current);
            if (generation === this.generation && this.share?.id === share.id)
              await offerShare(scope.courseId, scope.sessionId, share.id, viewer.id, sdp);
          })().catch(() => {
            current.close();
            if (this.peers.get(viewer.id) === current) this.peers.delete(viewer.id);
          });
        }
        if (viewer.answer && peer.signalingState === "have-local-offer")
          await peer.setRemoteDescription({ type: "answer", sdp: viewer.answer });
      }
      this.update({
        viewers: [...this.peers.values()].filter((peer) => peer.connectionState === "connected")
          .length
      });
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiError && [401, 403, 404, 409, 410].includes(error.status)) {
        await this.fail("Разрешение на демонстрацию отозвано или занятие завершено.");
        return;
      }
    }
    if (generation === this.generation)
      this.timer = setTimeout(() => void this.poll(generation), 1500);
  }
  private async startFrames(generation: number) {
    if (!this.state.stream || typeof document === "undefined") return;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.state.stream;
    this.frameVideo = video;
    this.frameCanvas = document.createElement("canvas");
    try {
      await video.play();
    } catch {
      return;
    }
    if (generation === this.generation) void this.sendFrame(generation);
  }
  private async sendFrame(generation: number) {
    const video = this.frameVideo,
      canvas = this.frameCanvas,
      scope = this.state.scope,
      share = this.share;
    if (generation !== this.generation || !video || !canvas || !scope || !share) return;
    try {
      if (
        !this.state.paused &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const scale = Math.min(1920 / video.videoWidth, 1080 / video.videoHeight, 1);
        canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        let blob: Blob | null = null;
        for (const quality of [0.84, 0.72, 0.58]) {
          blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", quality)
          );
          if (blob && blob.size <= 256 * 1024) break;
          if (generation !== this.generation) return;
        }
        if (blob && blob.size <= 256 * 1024 && generation === this.generation) {
          this.channel?.postMessage({ type: "frame", shareId: share.id, frame: blob });
          this.frameAbort = new AbortController();
          await uploadShareFrame(
            scope.courseId,
            scope.sessionId,
            share.id,
            blob,
            this.frameAbort.signal
          );
        }
      }
    } catch {
      /* WebRTC continues; missing fallback frames expire instead of freezing. */
    }
    if (generation === this.generation)
      this.frameTimer = setTimeout(() => void this.sendFrame(generation), 600);
  }
  private newPeer(id: string, iceServers: RTCIceServer[]) {
    const peer = new RTCPeerConnection({ iceServers });
    this.state.stream?.getTracks().forEach((track) => peer.addTrack(track, this.state.stream!));
    this.peers.set(id, peer);
    return peer;
  }
  private startVideo(generation: number) {
    const stream = this.state.stream,
      scope = this.state.scope,
      share = this.share;
    if (
      typeof VideoEncoder === "undefined" ||
      generation !== this.generation ||
      this.state.phase !== "publishing" ||
      this.state.paused ||
      this.videoPublisher ||
      !stream ||
      !scope ||
      !share
    )
      return;
    const publisher = new ShareVideoPublisher();
    this.videoPublisher = publisher;
    const failed = () => {
      publisher.stop();
      if (this.videoPublisher !== publisher || generation !== this.generation) return;
      this.videoPublisher = null;
      this.videoRetry = setTimeout(() => {
        this.videoRetry = null;
        this.startVideo(generation);
      }, 5000);
    };
    void publisher.start(stream, { ...scope, shareId: share.id }, failed).catch(failed);
  }
  private stopVideo() {
    if (this.videoRetry) clearTimeout(this.videoRetry);
    this.videoRetry = null;
    this.videoPublisher?.stop();
    this.videoPublisher = null;
  }
  private async localMessage(value: unknown, generation: number) {
    if (!value || typeof value !== "object" || !this.share || this.state.phase !== "publishing")
      return;
    const message = value as Record<string, unknown>;
    if (typeof message.viewerId !== "string" || !/^[a-f0-9-]{36}$/.test(message.viewerId)) return;
    const id = message.viewerId;
    if (message.type === "request") {
      this.sendLocalStatus();
      if (this.localPeers.has(id)) this.localPeers.set(id, Date.now());
      if (this.peers.has(id) || this.localPeers.size >= 4) return;
      this.localPeers.set(id, Date.now());
      const peer = this.newPeer(id, []);
      try {
        await peer.setLocalDescription(await peer.createOffer());
        const sdp = await gatheredDescription(peer);
        if (generation === this.generation)
          this.channel?.postMessage({ type: "offer", viewerId: id, shareId: this.share?.id, sdp });
      } catch {
        peer.close();
        this.peers.delete(id);
        this.localPeers.delete(id);
      }
    } else if (
      message.type === "answer" &&
      message.shareId === this.share.id &&
      typeof message.sdp === "string" &&
      message.sdp.length < 65536
    ) {
      const peer = this.peers.get(id);
      if (this.localPeers.has(id) && peer?.signalingState === "have-local-offer")
        await peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
    } else if (message.type === "leave" && this.localPeers.has(id)) {
      this.peers.get(id)?.close();
      this.peers.delete(id);
      this.localPeers.delete(id);
    }
  }
  private sendLocalStatus() {
    this.channel?.postMessage({
      type: "status",
      shareId: this.share?.id,
      paused: this.state.paused
    });
  }
  setPaused(paused: boolean) {
    const changed = paused !== this.state.paused;
    this.state.stream?.getVideoTracks().forEach((track) => {
      track.enabled = !paused;
    });
    this.update({ paused });
    if (changed) {
      if (paused) this.stopVideo();
      else this.startVideo(this.generation);
    }
    this.sendLocalStatus();
  }
  private pagehide = () => {
    void this.stop();
  };
  async stop() {
    const scope = this.state.scope,
      share = this.share;
    ++this.generation;
    this.cancelSelection();
    this.publishGeneration = null;
    this.stopVideo();
    this.detachProjectionListener?.();
    this.detachProjectionListener = null;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameAbort?.abort();
    this.frameAbort = null;
    this.frameTimer = null;
    if (this.frameVideo) {
      this.frameVideo.pause();
      this.frameVideo.srcObject = null;
    }
    this.frameVideo = null;
    this.frameCanvas = null;
    if (this.timer) clearTimeout(this.timer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.timer = null;
    this.watchdog = null;
    this.state.stream?.getTracks().forEach((track) => track.stop());
    this.channel?.postMessage({ type: "stop" });
    this.channel?.close();
    this.channel = null;
    if (scope) bindPublicProjection(scope.joinCode, null);
    this.peers.forEach((peer) => peer.close());
    this.peers.clear();
    this.localPeers.clear();
    this.share = null;
    window.removeEventListener("pagehide", this.pagehide);
    this.update({
      phase: "idle",
      stream: null,
      error: null,
      sourceName: "",
      surface: "unknown",
      viewers: 0,
      paused: false,
      scope: null,
      localChannelId: null,
      choosing: false,
      pendingSource: null
    });
    if (scope && share) {
      try {
        await stopShare(scope.courseId, scope.sessionId, share.id);
      } catch {
        /* Lease expires if the transport is gone. */
      }
    }
  }
  private async fail(error: string) {
    const stopping = this.stop();
    this.update({ phase: "error", error });
    await stopping;
  }
}
export const screenShare = new ScreenShare();
