import { screenShare, type ShareSnapshot } from "../sharing/screenShare";

type NativeBridge = {
  platform: "MACOS" | "WINDOWS";
  nativeCapture: boolean;
  captureExclusion?: { supported: boolean; enabled: boolean; error?: string };
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
type NativeSnapshot = ShareSnapshot & { previewFrame?: string };
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
    if (detail.type === "preview")
      this.update({
        phase: "preview",
        error: null,
        ...(typeof detail.frameUrl === "string" &&
        detail.frameUrl.startsWith("data:image/jpeg;base64,")
          ? { previewFrame: detail.frameUrl }
          : {}),
        ...(typeof detail.sourceName === "string" ? { sourceName: detail.sourceName } : {})
      });
    if (detail.type === "capture-state") {
      const phase = detail.phase;
      if (phase === "idle") this.update({ phase: "idle", previewFrame: undefined, paused: false });
      if (phase === "preview") this.update({ phase: "preview" });
      if (phase === "live" || phase === "paused")
        this.update({ phase: "publishing", paused: phase === "paused", error: null });
    }
    if (detail.type === "error")
      this.update({
        phase: "error",
        error:
          typeof detail.message === "string"
            ? detail.message
            : detail.code === "SCREEN_RECORDING_PERMISSION_REQUIRED"
              ? "Разрешите запись экрана для Lecturer Projector в настройках macOS и выберите источник снова."
              : "Компонент не смог начать показ. Выберите источник снова."
      });
  };
  async choose(scope: NonNullable<ShareSnapshot["scope"]>) {
    this.update({ phase: "choosing", scope, error: null, previewFrame: undefined });
    nativeCommand("chooseSource");
  }
  async publish() {
    if (this.state.phase !== "preview") return;
    nativeCommand("publish");
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
    nativeCommand("stopCapture");
    this.update({ phase: "idle", previewFrame: undefined, paused: false, error: null });
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
