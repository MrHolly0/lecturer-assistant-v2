import { uploadShareVideoInit, uploadShareVideoSegment } from "../api/share-video-api";

type Scope = { courseId: string; sessionId: string; shareId: string };

/** Encodes the captured track once; independently decodable MP4 fragments travel over HTTPS. */
export class ShareVideoPublisher {
  private stopped = false;
  private controller = new AbortController();
  private cancel: (() => Promise<void>) | null = null;
  private queuedBytes = 0;
  private queuedParts = 0;
  private chain = Promise.resolve();

  async start(stream: MediaStream, scope: Scope, onFailure: (error: unknown) => void) {
    const { Output, NullTarget, Mp4OutputFormat, MediaStreamVideoTrackSource, Quality } =
      await import("mediabunny");
    if (this.stopped) return;
    const track = stream.getVideoTracks()[0];
    if (!track || typeof VideoEncoder === "undefined")
      throw new Error("Видеокодек недоступен в этом браузере");
    const settings = track.getSettings();
    const scale = Math.min(1920 / (settings.width || 1920), 1080 / (settings.height || 1080), 1);
    const width = Math.max(2, Math.floor(((settings.width || 1920) * scale) / 2) * 2);
    const height = Math.max(2, Math.floor(((settings.height || 1080) * scale) / 2) * 2);
    const epoch = crypto.randomUUID();
    let ftyp: Uint8Array | null = null;
    let moof: Uint8Array | null = null;
    let codec = "avc1.420028";
    let sequence = 0;
    const join = (a: Uint8Array, b: Uint8Array) => {
      const bytes = new Uint8Array(a.byteLength + b.byteLength);
      bytes.set(a);
      bytes.set(b, a.byteLength);
      return new Blob([bytes], { type: "video/mp4" });
    };
    const fail = (error: unknown) => {
      if (this.stopped) return;
      this.stop();
      onFailure(error);
    };
    const queue = (blob: Blob, send: () => Promise<void>) => {
      if (this.stopped) return;
      if (++this.queuedParts > 4 || (this.queuedBytes += blob.size) > 6 * 1024 * 1024) {
        fail(new Error("Соединение не успевает передавать видео"));
        return;
      }
      this.chain = this.chain
        .then(async () => {
          if (this.stopped) return;
          const deadline = setTimeout(() => fail(new Error("Передача видео прервана")), 5000);
          try {
            await send();
          } finally {
            clearTimeout(deadline);
          }
        })
        .catch(fail)
        .finally(() => {
          this.queuedParts--;
          this.queuedBytes -= blob.size;
        });
    };
    const output = new Output({
      target: new NullTarget(),
      format: new Mp4OutputFormat({
        fastStart: "fragmented",
        minimumFragmentDuration: 1,
        onFtyp: (bytes) => {
          ftyp = bytes.slice();
        },
        onMoov: (bytes) => {
          if (!ftyp || this.stopped) return;
          const blob = join(ftyp, bytes);
          queue(blob, () =>
            uploadShareVideoInit(scope, epoch, codec, blob, this.controller.signal)
          );
        },
        onMoof: (bytes) => {
          moof = bytes.slice();
        },
        onMdat: (bytes) => {
          if (!moof || this.stopped) return;
          const blob = join(moof, bytes);
          moof = null;
          const part = sequence++;
          queue(blob, () =>
            uploadShareVideoSegment(scope, epoch, part, blob, this.controller.signal)
          );
        }
      })
    });
    const source = new MediaStreamVideoTrackSource(track, {
      codec: "avc",
      fullCodecString: codec,
      quality: new Quality({ bitrate: 4_000_000 }),
      keyFrameInterval: 1,
      latencyMode: "realtime",
      contentHint: "detail",
      sizeChangeBehavior: "contain",
      transform: { width, height, frameRate: 15 },
      onEncoderConfig: (config) => {
        codec = config.codec;
      }
    });
    this.cancel = () => output.cancel();
    source.errorPromise.catch(fail);
    output.addVideoTrack(source, { frameRate: 15 });
    try {
      await output.start();
      if (this.stopped) await output.cancel();
    } catch (error) {
      fail(error);
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    void this.cancel?.().catch(() => undefined);
    this.cancel = null;
  }
}
