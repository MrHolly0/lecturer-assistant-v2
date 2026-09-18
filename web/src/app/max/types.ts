export type MaxPlatform = "ios" | "android" | "desktop" | "web";
export type MaxColorScheme = "light" | "dark";
export type MaxImpactStyle = "soft" | "light" | "medium" | "heavy" | "rigid";
export type MaxNotificationType = "error" | "success" | "warning";

export interface MaxInitDataUnsafe {
  query_id?: string;
  auth_date?: number;
  hash?: string;
  start_param?: unknown;
  [key: string]: unknown;
}

export interface MaxBackButton {
  isVisible?: boolean;
  show?: () => void;
  hide?: () => void;
  onClick?: (callback: () => void) => void;
  offClick?: (callback: () => void) => void;
}

export interface MaxHapticFeedback {
  impactOccurred?: (style: MaxImpactStyle, disableVibrationFallback?: boolean) => void;
  notificationOccurred?: (type: MaxNotificationType, disableVibrationFallback?: boolean) => void;
  selectionChanged?: (disableVibrationFallback?: boolean) => void;
}

export interface MaxWebApp {
  initData?: string;
  initDataUnsafe?: MaxInitDataUnsafe;
  platform?: MaxPlatform;
  version?: string;
  deviceName?: string;
  colorScheme?: MaxColorScheme;
  BackButton?: MaxBackButton;
  HapticFeedback?: MaxHapticFeedback;
  getViewportSize?: () => Promise<{ height: string; width: string }>;
  ready?: () => void;
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

export {};
