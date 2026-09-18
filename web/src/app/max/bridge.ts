import type {
  MaxColorScheme,
  MaxImpactStyle,
  MaxNotificationType,
  MaxPlatform,
  MaxWebApp
} from "./types";

export interface MaxViewportSize {
  height: number;
  width: number;
}

export interface MaxEnvironment {
  bridgeAvailable: boolean;
  isMax: boolean;
  platform: MaxPlatform | "browser";
  version: string | null;
  deviceName: string | null;
  initData: string;
  startParam: string | null;
  theme: MaxColorScheme;
  viewport: MaxViewportSize;
  hapticsSupported: boolean;
}

let readyNotified = false;

export function getMaxWebApp(): MaxWebApp | null {
  if (typeof window === "undefined") return null;
  return window.WebApp ?? null;
}

export function isMaxLaunch(webApp = getMaxWebApp()): boolean {
  if (!webApp) return false;
  return Boolean(webApp.initData || webApp.initDataUnsafe?.query_id);
}

export function readTheme(webApp = getMaxWebApp()): MaxColorScheme {
  if (webApp?.colorScheme === "dark" || webApp?.colorScheme === "light") {
    return webApp.colorScheme;
  }
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function readEnvironment(): MaxEnvironment {
  const webApp = getMaxWebApp();
  const isMax = isMaxLaunch(webApp);
  const browserViewport = readBrowserViewport();
  const platform = isMax && isKnownPlatform(webApp?.platform) ? webApp.platform : "browser";

  return {
    bridgeAvailable: webApp !== null,
    isMax,
    platform,
    version: isMax && webApp?.version ? webApp.version : null,
    deviceName: isMax && webApp?.deviceName ? webApp.deviceName : null,
    initData: isMax ? webApp?.initData ?? "" : "",
    startParam: isMax ? readStartParam(webApp) : null,
    theme: readTheme(isMax ? webApp : null),
    viewport: browserViewport,
    hapticsSupported: isMax && canUseHaptics(webApp)
  };
}

export function readStartParam(webApp = getMaxWebApp()): string | null {
  const unsafeValue = webApp?.initDataUnsafe?.start_param;
  if (typeof unsafeValue === "string" && unsafeValue.length > 0) return unsafeValue;
  if (!webApp?.initData) return null;

  try {
    return new URLSearchParams(webApp.initData).get("start_param");
  } catch {
    return null;
  }
}

export function notifyReady(): boolean {
  if (readyNotified) return true;
  const webApp = getMaxWebApp();
  if (!isMaxLaunch(webApp)) return false;

  readyNotified = true;
  if (typeof webApp?.ready !== "function") return true;
  return callSafely(() => webApp.ready?.());
}

export async function readViewport(): Promise<MaxViewportSize> {
  const fallback = readBrowserViewport();
  const webApp = getMaxWebApp();
  if (!isMaxLaunch(webApp) || typeof webApp?.getViewportSize !== "function") return fallback;

  try {
    const viewport = await webApp.getViewportSize();
    return {
      height: parseDimension(viewport.height, fallback.height),
      width: parseDimension(viewport.width, fallback.width)
    };
  } catch {
    return fallback;
  }
}

export function showBackButton(): boolean {
  const webApp = getMaxWebApp();
  if (!isMaxLaunch(webApp) || typeof webApp?.BackButton?.show !== "function") return false;
  return callSafely(() => webApp.BackButton?.show?.());
}

export function hideBackButton(): boolean {
  const webApp = getMaxWebApp();
  if (!isMaxLaunch(webApp) || typeof webApp?.BackButton?.hide !== "function") return false;
  return callSafely(() => webApp.BackButton?.hide?.());
}

export function subscribeBackButton(callback: () => void): () => void {
  const webApp = getMaxWebApp();
  const button = webApp?.BackButton;
  if (!isMaxLaunch(webApp) || typeof button?.onClick !== "function") return () => undefined;

  if (!callSafely(() => button.onClick?.(callback))) return () => undefined;
  return () => {
    if (typeof button.offClick === "function") callSafely(() => button.offClick?.(callback));
  };
}

export const haptics = {
  impact(style: MaxImpactStyle, disableVibrationFallback = false): boolean {
    const webApp = getMaxWebApp();
    if (!isMaxLaunch(webApp) || !canUseHaptics(webApp)) return false;
    return callSafely(() =>
      webApp?.HapticFeedback?.impactOccurred?.(style, disableVibrationFallback)
    );
  },
  notification(type: MaxNotificationType, disableVibrationFallback = false): boolean {
    const webApp = getMaxWebApp();
    if (!isMaxLaunch(webApp) || !canUseHaptics(webApp)) return false;
    return callSafely(() =>
      webApp?.HapticFeedback?.notificationOccurred?.(type, disableVibrationFallback)
    );
  },
  selectionChanged(disableVibrationFallback = false): boolean {
    const webApp = getMaxWebApp();
    if (!isMaxLaunch(webApp) || !canUseHaptics(webApp)) return false;
    return callSafely(() => webApp?.HapticFeedback?.selectionChanged?.(disableVibrationFallback));
  }
};

function canUseHaptics(webApp: MaxWebApp | null): boolean {
  if (!webApp?.HapticFeedback) return false;
  return webApp.platform !== "desktop" && webApp.platform !== "web";
}

function readBrowserViewport(): MaxViewportSize {
  if (typeof window === "undefined") return { height: 0, width: 0 };
  return {
    height: Math.round(window.visualViewport?.height ?? window.innerHeight),
    width: Math.round(window.visualViewport?.width ?? window.innerWidth)
  };
}

function parseDimension(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function isKnownPlatform(value: unknown): value is MaxPlatform {
  return value === "ios" || value === "android" || value === "desktop" || value === "web";
}

function callSafely(callback: () => void): boolean {
  try {
    callback();
    return true;
  } catch {
    return false;
  }
}
