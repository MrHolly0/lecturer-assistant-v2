import {
  getShareVideoManifest,
  getShareVideoPart,
  type ShareVideoManifest,
  type VideoViewerScope
} from "../api/share-video-api";

type Callbacks = { onUrl: (url: string | null) => void; onFailure: (error: unknown) => void };

function sourceConstructor(): typeof MediaSource | null {
  return (
    (window as Window & { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ??
    (typeof MediaSource === "undefined" ? null : MediaSource)
  );
}

/** A bounded live MP4 buffer attached directly to the student's native video element. */
export class ShareVideoPlayback {
  private stopped = false;
  private busy = false;
  private controller = new AbortController();
  private media: MediaSource | null = null;
  private buffer: SourceBuffer | null = null;
  private url: string | null = null;
  private epoch: string | null = null;
  private lastSequence = -1;
  private lastReceived = 0;
  private retryAfter = 0;

  constructor(
    private scope: VideoViewerScope,
    private shareId: string,
    private callbacks: Callbacks
  ) {}

  isReady() {
    return Boolean(this.url && this.lastReceived && Date.now() - this.lastReceived < 5000);
  }

  private clear() {
    this.buffer = null;
    this.media = null;
    this.epoch = null;
    this.lastSequence = -1;
    this.lastReceived = 0;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.callbacks.onUrl(null);
  }

  private append(bytes: ArrayBuffer) {
    const buffer = this.buffer;
    if (!buffer || !this.media || this.media.readyState !== "open" || this.stopped)
      return Promise.reject(new Error("Видеоплеер закрыт"));
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        buffer.removeEventListener("updateend", done);
        buffer.removeEventListener("error", failed);
        this.controller.signal.removeEventListener("abort", failed);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("Не удалось прочитать видео"));
      };
      buffer.addEventListener("updateend", done, { once: true });
      buffer.addEventListener("error", failed, { once: true });
      this.controller.signal.addEventListener("abort", failed, { once: true });
      try {
        buffer.appendBuffer(bytes);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  private async open(manifest: ShareVideoManifest, source: typeof MediaSource) {
    const mime = `video/mp4; codecs="${manifest.codec}"`;
    if (!/^avc1\.[0-9a-f]{6}$/i.test(manifest.codec) || !source.isTypeSupported(mime))
      throw new Error("Видеоформат недоступен в этом браузере");
    const first = Math.max(manifest.firstSequence, manifest.lastSequence - 1);
    const [init, fragment] = await Promise.all([
      getShareVideoPart(this.scope, manifest.epoch, "init", this.controller.signal),
      getShareVideoPart(this.scope, manifest.epoch, first, this.controller.signal)
    ]);
    if (this.stopped) return;
    this.clear();
    this.epoch = manifest.epoch;
    const media = new source();
    this.media = media;
    const opened = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        media.removeEventListener("sourceopen", ready);
        this.controller.signal.removeEventListener("abort", failed);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("Видеоплеер закрыт"));
      };
      media.addEventListener("sourceopen", ready, { once: true });
      this.controller.signal.addEventListener("abort", failed, { once: true });
    });
    this.url = URL.createObjectURL(media);
    this.callbacks.onUrl(this.url);
    await opened;
    if (this.stopped || this.media !== media) return;
    this.buffer = media.addSourceBuffer(mime);
    media.duration = Infinity;
    await this.append(init);
    await this.append(fragment);
    this.lastSequence = first;
    this.lastReceived = Date.now();
  }

  async refresh() {
    const source = sourceConstructor();
    if (this.stopped || this.busy || !source || Date.now() < this.retryAfter) return;
    this.busy = true;
    const deadline = setTimeout(() => this.controller.abort(), 5000);
    try {
      const manifest = await getShareVideoManifest(this.scope, this.controller.signal);
      if (this.stopped) return;
      if (!manifest || manifest.shareId !== this.shareId) {
        this.clear();
        return;
      }
      if (
        this.epoch !== manifest.epoch ||
        this.lastSequence < manifest.firstSequence - 1 ||
        !this.buffer ||
        this.media?.readyState !== "open"
      )
        await this.open(manifest, source);
      for (
        let count = 0;
        !this.stopped && this.lastSequence < manifest.lastSequence && count < 3;
        count++
      ) {
        const next = this.lastSequence + 1;
        const part = await getShareVideoPart(
          this.scope,
          manifest.epoch,
          next,
          this.controller.signal
        );
        if (this.stopped) return;
        await this.append(part);
        this.lastSequence = next;
        this.lastReceived = Date.now();
      }
      const buffer = this.buffer;
      if (buffer && !buffer.updating && buffer.buffered.length) {
        const end = buffer.buffered.end(buffer.buffered.length - 1);
        this.media?.setLiveSeekableRange(Math.max(buffer.buffered.start(0), end - 6), end);
        if (end - buffer.buffered.start(0) > 12) {
          await new Promise<void>((resolve) => {
            buffer.addEventListener("updateend", () => resolve(), { once: true });
            buffer.remove(0, end - 8);
          });
        }
      }
      if (this.lastReceived && Date.now() - this.lastReceived >= 5000) this.clear();
    } catch (error) {
      if (this.stopped) return;
      this.clear();
      this.retryAfter = Date.now() + 2500;
      this.callbacks.onFailure(error);
    } finally {
      clearTimeout(deadline);
      if (!this.stopped && this.controller.signal.aborted) this.controller = new AbortController();
      this.busy = false;
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    this.clear();
  }
}
