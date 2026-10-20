import {
  SHARE_FRAME_RATE,
  SHARE_MAX_PIXELS,
  shareDimensions,
  shareVideoBitrate
} from "./shareQuality";
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
    const {
      Output,
      NullTarget,
      Mp4OutputFormat,
      MediaStreamVideoTrackSource,
      Quality,
      canEncodeVideo
    } = await import("mediabunny");
    if (this.stopped) return;
    const track = stream.getVideoTracks()[0];
    if (!track || typeof VideoEncoder === "undefined")
      throw new Error("Видеокодек недоступен в этом браузере");
    const settings = track.getSettings();
    let size: { width: number; height: number } | null = null;
    for (const pixels of [SHARE_MAX_PIXELS, 2560 * 1440, 1920 * 1080]) {
      const candidate = shareDimensions(settings.width ?? 1920, settings.height ?? 1080, pixels);
      if (
        await canEncodeVideo("avc", {
          ...candidate,
          frameRate: SHARE_FRAME_RATE,
          latencyMode: "realtime",
          contentHint: "text",
          quality: new Quality({ bitrate: shareVideoBitrate(candidate.width, candidate.height) })
        })
      ) {
        size = candidate;
        break;
      }
      if (this.stopped) return;
    }
    if (!size) throw new Error("Видеокодек недоступен для выбранного источника");
    if (this.stopped) return;
    const { width, height } = size;
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
      quality: new Quality({ bitrate: shareVideoBitrate(width, height) }),
      keyFrameInterval: 1,
      latencyMode: "realtime",
      contentHint: "text",
      sizeChangeBehavior: "contain",
      transform: { width, height, frameRate: SHARE_FRAME_RATE },
      onEncoderConfig: (config) => {
        codec = config.codec;
      }
    });
    this.cancel = () => output.cancel();
    source.errorPromise.catch(fail);
    output.addVideoTrack(source, { frameRate: SHARE_FRAME_RATE });
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
