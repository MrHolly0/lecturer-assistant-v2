import { screenShare, type ShareSnapshot } from "../sharing/screenShare";
import { closePublicProjection } from "./browserProjection";

type NativeBridge = {
  platform: "MACOS" | "WINDOWS";
  nativeCapture: boolean;
  theme?: "light" | "dark";
  captureExclusion?: { supported: boolean; enabled: boolean; error?: string };
  captureModes?: { window?: boolean; application?: boolean; protectedDisplay?: boolean };
  postMessage: (message: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    lectureProjectorNative?: NativeBridge;
  }
}
export function nativeBridge(): NativeBridge | undefined {
  return typeof window === "undefined" ? undefined : window.lectureProjectorNative;
}
export function nativeCommand(action: string, values: Record<string, unknown> = {}): void {
  nativeBridge()?.postMessage({ type: "LECTURE_REMOTE", action, ...values });
}
type NativeSnapshot = ShareSnapshot & {
  previewFrame?: string;
  permissionPending?: boolean;
  permissionDenied?: boolean;
  sourceKind?: "window" | "application" | "display";
  captureExcludesRemote?: boolean;
};
class NativeCapture {
  private state: NativeSnapshot = {
    phase: "idle",
    stream: null,
    sourceName: "",
    surface: "monitor",
    error: null,
    paused: false,
    viewers: 0,
    scope: null,
    localChannelId: null
  };
  private listeners = new Set<() => void>();
  private bound = false;
  private awaitingSourceChoice = false;
  private sourcePickerOpened = false;
  private pendingChoicePermission = false;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.bound && typeof window !== "undefined") {
      this.bound = true;
      window.addEventListener("lecture-projector-native", this.event);
      nativeCommand("ready");
    }
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<NativeSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private event = (event: Event) => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail;
    if (!detail || typeof detail !== "object") return;
    if (detail.type === "preview") {
      this.awaitingSourceChoice = false;
      this.sourcePickerOpened = false;
      this.pendingChoicePermission = false;
      this.update({
        phase: "preview",
        permissionPending: false,
        permissionDenied: false,
        error: null,
        ...(detail.sourceKind === "window" ||
        detail.sourceKind === "application" ||
        detail.sourceKind === "display"
          ? {
              sourceKind: detail.sourceKind,
              surface: detail.sourceKind === "display" ? "monitor" : "window"
            }
          : {}),
        ...(typeof detail.captureExcludesRemote === "boolean"
          ? { captureExcludesRemote: detail.captureExcludesRemote }
          : {}),
        ...(typeof detail.frameUrl === "string" &&
        detail.frameUrl.startsWith("data:image/jpeg;base64,")
          ? { previewFrame: detail.frameUrl }
          : {}),
        ...(typeof detail.sourceName === "string" ? { sourceName: detail.sourceName } : {})
      });
    }
    if (detail.type === "capture-state") {
      const phase = detail.phase;
      if (phase === "permission" || phase === "choosing")
        this.update({
          phase: "choosing",
          permissionPending: phase === "permission",
          error: null
        });
      if (phase === "choosing" || phase === "permission") this.sourcePickerOpened = true;
      if (phase === "idle" && this.awaitingSourceChoice && !this.sourcePickerOpened) {
        // The native helper first tears down the previous capture. Keep the newly selected
        // lesson scope through that internal reset; a later idle after the picker opens is
        // a real cancellation and clears it.
        this.awaitingSourceChoice = false;
        this.update({
          phase: "choosing",
          sourceName: "",
          sourceKind: undefined,
          captureExcludesRemote: undefined,
          previewFrame: undefined,
          paused: false,
          permissionPending: this.pendingChoicePermission,
          permissionDenied: false,
          error: null
        });
      } else if (phase === "idle") {
        this.awaitingSourceChoice = false;
        this.sourcePickerOpened = false;
        this.pendingChoicePermission = false;
        this.update({
          phase: "idle",
          sourceName: "",
          sourceKind: undefined,
          captureExcludesRemote: undefined,
          previewFrame: undefined,
          paused: false,
          permissionPending: false,
          permissionDenied: false,
          error: null,
          scope: null,
          localChannelId: null,
          viewers: 0
        });
      }
      if (phase === "preview") {
        this.awaitingSourceChoice = false;
        this.sourcePickerOpened = false;
        this.pendingChoicePermission = false;
        this.update({ phase: "preview", permissionPending: false });
      }
      if (phase === "live" || phase === "paused")
        this.update({
          phase: "publishing",
          paused: phase === "paused",
          error: null,
          permissionPending: false
        });
    }
    if (detail.type === "error") {
      this.awaitingSourceChoice = false;
      this.sourcePickerOpened = false;
      this.pendingChoicePermission = false;
      const permissionDenied = detail.code === "SCREEN_RECORDING_PERMISSION_REQUIRED";
      const canChooseWindowWithoutGlobalPermission =
        nativeBridge()?.platform === "MACOS" &&
        nativeBridge()?.captureModes?.window === true &&
        nativeBridge()?.captureModes?.application === true;
      this.update({
        phase: "error",
        permissionPending: false,
        permissionDenied,
        error:
          permissionDenied && canChooseWindowWithoutGlobalPermission
            ? "macOS не разрешила захват всего экрана. Выберите окно или приложение в системном меню; повторно выдавать разрешение не нужно."
            : typeof detail.message === "string"
              ? detail.message
              : "Компонент не смог начать показ. Выберите источник снова."
      });
    }
  };
  async choose(scope: NonNullable<ShareSnapshot["scope"]>, mode: "window" | "display" = "window") {
    this.awaitingSourceChoice = true;
    this.sourcePickerOpened = false;
    this.pendingChoicePermission = mode === "display";
    this.update({
      phase: "choosing",
      scope,
      error: null,
      previewFrame: undefined,
      permissionPending: mode === "display",
      permissionDenied: false,
      captureExcludesRemote: undefined,
      sourceKind: undefined
    });
    nativeCommand(mode === "display" ? "chooseDisplay" : "chooseSource");
  }
  async publish() {
    if (this.state.phase !== "preview") return;
    nativeCommand("publish");
    if (["publishing", "error"].includes(this.getSnapshot().phase)) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        detach();
        resolve();
      };
      const detach = this.subscribe(() => {
        if (this.state.phase === "publishing" || this.state.phase === "error") finish();
      });
      const timer = setTimeout(() => {
        this.update({
          phase: "error",
          error: "Показ не подтвердился. Проверьте связь и повторите."
        });
        finish();
      }, 20_000);
    });
  }
  async stop() {
    this.awaitingSourceChoice = false;
    this.sourcePickerOpened = false;
    this.pendingChoicePermission = false;
    nativeCommand("stopCapture");
    this.update({
      phase: "idle",
      sourceName: "",
      sourceKind: undefined,
      captureExcludesRemote: undefined,
      previewFrame: undefined,
      paused: false,
      error: null,
      permissionPending: false,
      permissionDenied: false,
      scope: null,
      localChannelId: null,
      viewers: 0
    });
  }
  setPaused(paused: boolean) {
    if (this.state.paused === paused) return;
    nativeCommand("pause", { paused });
    this.update({ paused });
  }
}
export const nativeCapture = new NativeCapture();
export function workspaceShare(): typeof screenShare | NativeCapture {
  return nativeBridge()?.nativeCapture ? nativeCapture : screenShare;
}

export async function stopWorkspaceProjection(joinCode: string): Promise<void> {
  await workspaceShare().stop();
  if (nativeBridge()) nativeCommand("stopProjection");
  else closePublicProjection(joinCode);
}
