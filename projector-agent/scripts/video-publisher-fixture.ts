import { ShareVideoPublisher } from "../../web/src/app/sharing/videoPublisher";
import { configureHelperContext } from "../../web/src/app/projection/helperContext";

const identifier = "00000000-0000-4000-8000-000000000001";
const grant = identifier + "." + "a".repeat(64);
const scope = { courseId: identifier, sessionId: identifier, shareId: identifier };
configureHelperContext({ ...scope, controlToken: grant });

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition: unknown, code: string) => { if (!condition) throw new Error(code); };
const source = document.querySelector<HTMLCanvasElement>("#source")!;
const pixels = document.querySelector<HTMLCanvasElement>("#pixels")!;
const video = document.querySelector<HTMLVideoElement>("#decoded")!;
const painter = source.getContext("2d")!;
const reader = pixels.getContext("2d", { willReadFrequently: true })!;
let animation = 0;
let painting = true;
const paint = (time: number) => {
  if (!painting) return;
  painter.fillStyle = Math.floor(time / 450) % 2 ? "#f01020" : "#1020f0";
  painter.fillRect(0, 0, source.width, source.height);
  painter.fillStyle = "#fff";
  painter.font = "24px sans-serif";
  painter.fillText(String(Math.floor(time)), 100, 110);
  animation = requestAnimationFrame(paint);
};
paint(performance.now());

const parts: { sequence: number; bytes: Uint8Array }[] = [];
let init: Uint8Array | null = null;
let epoch: string | null = null;
let mime = "";
let uploadCount = 0;
let forbiddenRequests = 0;
let failure: unknown = null;
let mediaSource: MediaSource | null = null;
let objectUrl: string | null = null;
let stream: MediaStream | null = null;
let publisher: ShareVideoPublisher | null = null;
const nativeFetch = window.fetch;
const box = (bytes: Uint8Array, name: string) => {
  for (let at = 0; at + 8 <= bytes.length;) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
    if (String.fromCharCode(...bytes.slice(at + 4, at + 8)) === name) return true;
    if (size < 8) return false;
    at += size;
  }
  return false;
};
window.fetch = async (input, options) => {
  try {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const path = new RegExp("^/api/v1/courses/" + identifier + "/sessions/" + identifier + "/screen-share/" + identifier + "/video/([a-f0-9-]{36})/(init|segments/(\\d+))$");
    const match = path.exec(url.pathname);
    assert(url.origin === location.origin && match && options?.method === "PUT", "UNEXPECTED_NETWORK_REQUEST");
    assert(options?.credentials === "omit", "CREDENTIALS_NOT_OMITTED");
    const headers = new Headers(options?.headers);
    assert(headers.get("X-Lecture-Control-Token") === grant && !headers.has("Authorization"), "UNSCOPED_AUTH");
    assert(options?.body instanceof Blob, "NON_BINARY_UPLOAD");
    const bytes = new Uint8Array(await (options!.body as Blob).arrayBuffer());
    assert(!epoch || epoch === match![1], "CHANGED_EPOCH");
    epoch = match![1]; uploadCount++;
    if (match![2] === "init") {
      assert(!init && !parts.length && box(bytes, "ftyp") && box(bytes, "moov"), "INVALID_OR_LATE_INIT");
      init = bytes;
      mime = 'video/mp4; codecs="' + url.searchParams.get("codec") + '"';
    } else {
      assert(init && Number(match![3]) === parts.length && box(bytes, "moof") && box(bytes, "mdat"), "INVALID_SEGMENT_ORDER");
      parts.push({ sequence: Number(match![3]), bytes });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    forbiddenRequests++; failure = error;
    throw error;
  }
};

async function until(predicate: () => boolean, timeout: number, code: string) {
  const start = performance.now();
  while (!predicate()) {
    if (failure) throw failure;
    assert(performance.now() - start < timeout, code);
    await delay(30);
  }
}
async function run() {
  let result: Record<string, unknown>;
  try {
    assert(typeof VideoEncoder !== "undefined" && typeof MediaSource !== "undefined", "MEDIA_APIS_UNAVAILABLE");
    stream = source.captureStream(15);
    publisher = new ShareVideoPublisher();
    await publisher.start(stream, scope, (error) => { failure = error; });
    await until(() => !!init && parts.length >= 3, 20000, "ENCODE_TIMEOUT");
    assert(MediaSource.isTypeSupported(mime), "MSE_CODEC_UNSUPPORTED");
    mediaSource = new MediaSource(); objectUrl = URL.createObjectURL(mediaSource); video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      mediaSource!.addEventListener("sourceopen", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("VIDEO_OPEN_FAILED")), { once: true });
    });
    const buffer = mediaSource.addSourceBuffer(mime);
    let appended = 0;
    const append = async (bytes: Uint8Array) => {
      await new Promise<void>((resolve, reject) => {
        buffer.addEventListener("updateend", () => resolve(), { once: true });
        buffer.addEventListener("error", () => reject(new Error("MSE_APPEND_FAILED")), { once: true });
        buffer.appendBuffer(bytes as Uint8Array<ArrayBuffer>);
      });
    };
    await append(init!);
    for (; appended < parts.length; appended++) await append(parts[appended].bytes);
    await video.play();
    const startTime = video.currentTime;
    const colors = new Set<string>();
    const sampleStart = performance.now();
    while (performance.now() - sampleStart < 4000) {
      if (failure) throw failure;
      if (video.readyState >= 2) {
        reader.drawImage(video, 0, 0);
        const color = reader.getImageData(20, 20, 1, 1).data;
        if (color[0] > color[2] + 80) colors.add("red");
        if (color[2] > color[0] + 80) colors.add("blue");
      }
      for (; appended < parts.length; appended++) await append(parts[appended].bytes);
      await delay(60);
    }
    const advanced = video.currentTime - startTime;
    const frames = video.getVideoPlaybackQuality().totalVideoFrames;
    assert(colors.size === 2, "DECODED_PIXELS_DID_NOT_CHANGE");
    assert(advanced > 1 && frames > 5, "PLAYBACK_DID_NOT_ADVANCE");
    publisher.stop(); stream.getTracks().forEach((track) => track.stop());
    painting = false; cancelAnimationFrame(animation);
    await delay(250); const afterStop = uploadCount; await delay(1200);
    assert(uploadCount === afterStop, "UPLOADS_CONTINUED_AFTER_STOP");
    assert(stream.getTracks().every((track) => track.readyState === "ended"), "TRACKS_NOT_STOPPED");
    video.pause(); video.removeAttribute("src"); video.load();
    if (mediaSource.readyState === "open") mediaSource.endOfStream();
    URL.revokeObjectURL(objectUrl); objectUrl = null;
    // Chromium can retain the last currentSrc string after load() has emptied the resource.
    await until(() => !video.hasAttribute("src") && !video.srcObject && video.paused &&
      video.networkState === HTMLMediaElement.NETWORK_EMPTY && video.readyState === HTMLMediaElement.HAVE_NOTHING,
    2000, "VIDEO_NOT_TORN_DOWN");
    result = {
      success: true, ownCanvasSourceOnly: true, actualPublisher: true, scopedUploadCredentials: true,
      h264InitOrdered: true, segmentSequenceOrdered: true, mseDecodeVerified: true,
      decodedPixelsChanged: true, playbackTimeAdvanced: true, stopNoFurtherUploads: true,
      tracksStopped: true, teardownComplete: true, nativePickerTested: false,
      desktopCaptured: false, captureExclusionPixelsVerified: false, userInstallationChanged: false,
      externalNetworkUsed: false, segments: parts.length, decodedFrames: frames,
      playbackSeconds: advanced, forbiddenRequests
    };
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : "VIDEO_FIXTURE_FAILED", segments: parts.length, forbiddenRequests,
      teardown: { hasCurrentSrc: !!video.currentSrc, hasSrcObject: !!video.srcObject, paused: video.paused, networkState: video.networkState, readyState: video.readyState } };
  } finally {
    publisher?.stop(); stream?.getTracks().forEach((track) => track.stop());
    painting = false; cancelAnimationFrame(animation); video.pause();
    video.removeAttribute("src"); video.load(); if (objectUrl) URL.revokeObjectURL(objectUrl);
    window.fetch = nativeFetch;
  }
  (window as unknown as { videoFixtureResult: unknown }).videoFixtureResult = result;
}
void run();
