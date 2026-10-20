export type CaptureSurface = "window" | "browser" | "monitor" | "unknown";

export function captureSurface(settings: { displaySurface?: string }): CaptureSurface {
  const surface = settings.displaySurface;
  return surface === "window" || surface === "browser" || surface === "monitor"
    ? surface
    : "unknown";
}

/** Browsers without surface metadata still use the explicit preview and confirmation. */
export function validateCaptureSurface(settings: { displaySurface?: string }): string | null {
  if (!settings.displaySurface || captureSurface(settings) !== "unknown") return null;
  return "Браузер вернул неподдерживаемый источник демонстрации. Выберите источник снова.";
}
export const captureOptions = {
  video: {
    displaySurface: "window",
    // Do not downscale the source before it reaches the projector or video encoder.
    frameRate: { ideal: 15, max: 20 }
  },
  audio: false,
  monitorTypeSurfaces: "include",
  selfBrowserSurface: "exclude",
  surfaceSwitching: "exclude",
  systemAudio: "exclude"
};
