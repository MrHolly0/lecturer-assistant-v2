/** Full-monitor capture is unavailable until our native pipeline can exclude private controls. */
export function validateCaptureSurface(settings: { displaySurface?: string }): string | null {
  if (settings.displaySurface === "browser" || settings.displaySurface === "window") return null;
  if (settings.displaySurface === "monitor")
    return "Выберите отдельное окно или вкладку. При захвате всего экрана пульт и личные вопросы могут попасть в кадр.";
  return "Браузер не подтвердил захват отдельного окна. Откройте демонстрацию в актуальном Chrome или Edge.";
}
export const captureOptions = {
  video: {
    displaySurface: "window",
    frameRate: { ideal: 15, max: 20 },
    width: { ideal: 1280, max: 1920 }
  },
  audio: false,
  monitorTypeSurfaces: "exclude",
  selfBrowserSurface: "exclude",
  surfaceSwitching: "exclude",
  systemAudio: "exclude"
};
