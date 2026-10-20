/** Preserve small text before frame rate; bounds apply to transport, never to capture. */
export const SHARE_FRAME_RATE = 15;
export const SHARE_FRAME_MAX_BYTES = 2 * 1024 * 1024;
export const SHARE_MAX_PIXELS = 3840 * 2160;

export function shareDimensions(width: number, height: number, maxPixels = SHARE_MAX_PIXELS) {
  const w = Number.isFinite(width) && width > 0 ? width : 1920;
  const h = Number.isFinite(height) && height > 0 ? height : 1080;
  const scale = Math.min(1, 3840 / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  return {
    width: Math.max(2, Math.floor((w * scale) / 2) * 2),
    height: Math.max(2, Math.floor((h * scale) / 2) * 2)
  };
}

export function shareVideoBitrate(width: number, height: number) {
  return Math.round(
    Math.min(
      12_000_000,
      Math.max(6_000_000, 6_000_000 * Math.sqrt((width * height) / (1920 * 1080)))
    )
  );
}

/** Unsupported tuning must not prevent the ordinary WebRTC connection. */
export async function configureScreenSenders(peer: RTCPeerConnection, local: boolean) {
  await Promise.all(
    peer.getSenders().map(async (sender) => {
      if (sender.track?.kind !== "video") return;
      const settings = sender.track.getSettings();
      const { width, height } = shareDimensions(settings.width ?? 1920, settings.height ?? 1080);
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) return;
      parameters.degradationPreference = "maintain-resolution";
      for (const encoding of parameters.encodings) {
        encoding.scaleResolutionDownBy = 1;
        encoding.maxFramerate = SHARE_FRAME_RATE;
        encoding.maxBitrate = Math.min(
          local ? 32_000_000 : 16_000_000,
          shareVideoBitrate(width, height) * (local ? 3 : 1.5)
        );
      }
      try {
        await sender.setParameters(parameters);
      } catch {
        // Some engines reject degradationPreference; still try the portable encoding limits.
        const compatible = sender.getParameters();
        for (const [index, encoding] of compatible.encodings.entries()) {
          Object.assign(encoding, parameters.encodings[index]);
        }
        delete compatible.degradationPreference;
        await sender.setParameters(compatible).catch(() => undefined);
      }
    })
  );
}

/** Prefer a detailed frame at a lower cadence to a heavily quantized preview. */
export async function encodeShareFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  for (const maxPixels of [SHARE_MAX_PIXELS, 2560 * 1440, 1920 * 1080]) {
    const size = shareDimensions(video.videoWidth, video.videoHeight, maxPixels);
    canvas.width = size.width;
    canvas.height = size.height;
    context.imageSmoothingQuality = "high";
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.94, 0.88]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality)
      );
      if (blob && blob.size <= SHARE_FRAME_MAX_BYTES) return blob;
    }
  }
  return null;
}
