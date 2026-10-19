import { screenShare, type ShareSnapshot } from "../sharing/screenShare";
import { closePublicProjection } from "./browserProjection";

type NativeBridge = {
  platform: "MACOS" | "WINDOWS";
  nativeCapture: boolean;
  theme?: "light" | "dark";
  captureExclusion?: { supported: boolean; enabled: boolean; error?: string };
  captureModes?: {
    window?: boolean;
    application?: boolean;
    protectedDisplay?: boolean;
    manualWindow?: boolean;
  };
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
  captureMode?: "system-window" | "manual-window" | "display";
  requestId?: string;
  errorCode?: string;
};
type NativeCaptureScope = NonNullable<ShareSnapshot["scope"]>;
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
  private requestSequence = 0;
  private activeRequestId: string | null = null;
  private legacyTerminalErrorPending = false;
  private knownScope: NativeCaptureScope | null = null;
  private pendingSnapshotSyncId: string | null = null;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.bound && typeof window !== "undefined") {
      this.bound = true;
      window.addEventListener("lecture-projector-native", this.event);
      window.addEventListener("focus", this.refreshStatus);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this.onVisibilityChange);
      }
      if (this.knownScope) this.refreshStatus();
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
    if (detail.type === "capture-snapshot") {
      this.adoptSnapshot(detail);
      return;
    }
    const eventRequestId = typeof detail.requestId === "string" ? detail.requestId : null;
    if (eventRequestId && eventRequestId !== this.activeRequestId) return;
    const strictRequestCorrelation = nativeBridge()?.captureModes?.manualWindow === true;
    if (!eventRequestId && strictRequestCorrelation) return;
    if (
      !this.activeRequestId &&
      (detail.type === "preview" ||
        (detail.type === "error" &&
          (eventRequestId !== null ||
            !this.legacyTerminalErrorPending ||
            strictRequestCorrelation)))
    )
      return;
    const eventCaptureMode =
      detail.captureMode === "system-window" ||
      detail.captureMode === "manual-window" ||
      detail.captureMode === "display"
        ? detail.captureMode
        : undefined;
    if (detail.type === "preview") {
      this.legacyTerminalErrorPending = false;
      this.awaitingSourceChoice = false;
      this.sourcePickerOpened = false;
      this.pendingChoicePermission = false;
      this.update({
        phase: "preview",
        permissionPending: false,
        permissionDenied: false,
        error: null,
        errorCode: undefined,
        captureMode: eventCaptureMode ?? this.state.captureMode,
        requestId: this.activeRequestId ?? undefined,
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
          error: null,
          errorCode: undefined,
          captureMode: eventCaptureMode ?? this.state.captureMode,
          ...(detail.sourceKind === "window" ||
          detail.sourceKind === "application" ||
          detail.sourceKind === "display"
            ? {
                sourceKind: detail.sourceKind,
                surface: detail.sourceKind === "display" ? "monitor" : "window"
              }
            : {})
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
        this.activeRequestId = null;
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
          errorCode: undefined,
          captureMode: undefined,
          requestId: undefined,
          scope: null,
          localChannelId: null,
          viewers: 0
        });
      }
      if (phase === "preview") {
        this.awaitingSourceChoice = false;
        this.sourcePickerOpened = false;
        this.pendingChoicePermission = false;
        this.legacyTerminalErrorPending = false;
        this.update({
          phase: "preview",
          permissionPending: false,
          captureMode: eventCaptureMode ?? this.state.captureMode,
          ...(detail.sourceKind === "window" ||
          detail.sourceKind === "application" ||
          detail.sourceKind === "display"
            ? {
                sourceKind: detail.sourceKind,
                surface: detail.sourceKind === "display" ? "monitor" : "window"
              }
            : {}),
          ...(typeof detail.sourceName === "string" ? { sourceName: detail.sourceName } : {}),
          ...(typeof detail.captureExcludesRemote === "boolean"
            ? { captureExcludesRemote: detail.captureExcludesRemote }
            : {})
        });
      }
      if (phase === "live" || phase === "paused")
        this.update({
          phase: "publishing",
          paused: phase === "paused",
          error: null,
          permissionPending: false,
          errorCode: undefined,
          captureMode: eventCaptureMode ?? this.state.captureMode
        });
    }
    if (detail.type === "error") {
      this.activeRequestId = null;
      this.legacyTerminalErrorPending = false;
      this.awaitingSourceChoice = false;
      this.sourcePickerOpened = false;
      this.pendingChoicePermission = false;
      const captureMode = eventCaptureMode ?? this.state.captureMode;
      const permissionDenied =
        detail.code === "SCREEN_RECORDING_PERMISSION_REQUIRED" && captureMode === "display";
      const canChooseWindowWithoutGlobalPermission =
        nativeBridge()?.platform === "MACOS" &&
        nativeBridge()?.captureModes?.window === true &&
        nativeBridge()?.captureModes?.application === true;
      this.update({
        phase: "error",
        permissionPending: false,
        permissionDenied,
        errorCode: typeof detail.code === "string" ? detail.code : undefined,
        captureMode,
        requestId: undefined,
        error:
          detail.code === "CAPTURE_SYSTEM_PICKER_TIMED_OUT"
            ? "Системное меню выбора источника не открылось. Повторите системный выбор или выберите окно вручную."
            : permissionDenied && canChooseWindowWithoutGlobalPermission
              ? "macOS не разрешила захват всего экрана. Выберите окно или приложение в системном меню; повторно выдавать разрешение не нужно."
              : detail.code === "SCREEN_RECORDING_PERMISSION_REQUIRED" &&
                  captureMode === "manual-window"
                ? typeof detail.message === "string"
                  ? detail.message
                  : "macOS не разрешила запись выбранного окна. Проверьте доступ помощника в настройках «Запись экрана»."
                : typeof detail.message === "string"
                  ? detail.message
                  : "Компонент не смог начать показ. Выберите источник снова."
      });
    }
  };
  async choose(
    scope: NonNullable<ShareSnapshot["scope"]>,
    mode: "window" | "display" | "manual-window" = "window"
  ) {
    this.pendingSnapshotSyncId = null;
    const requestId = this.nextRequestId();
    this.activeRequestId = requestId;
    this.legacyTerminalErrorPending = nativeBridge()?.captureModes?.manualWindow !== true;
    this.awaitingSourceChoice = true;
    this.sourcePickerOpened = false;
    this.pendingChoicePermission = mode !== "window";
    this.update({
      phase: "choosing",
      scope,
      error: null,
      errorCode: undefined,
      captureMode:
        mode === "display"
          ? "display"
          : mode === "manual-window"
            ? "manual-window"
            : "system-window",
      requestId,
      previewFrame: undefined,
      permissionPending: mode !== "window",
      permissionDenied: false,
      captureExcludesRemote: undefined,
      sourceKind: undefined
    });
    nativeCommand(
      mode === "display"
        ? "chooseDisplay"
        : mode === "manual-window"
          ? "chooseWindowFallback"
          : "chooseSource",
      { requestId }
    );
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
    this.pendingSnapshotSyncId = null;
    this.activeRequestId = null;
    this.legacyTerminalErrorPending = false;
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
      captureMode: undefined,
      requestId: undefined,
      errorCode: undefined,
      paused: false,
      error: null,
      permissionPending: false,
      permissionDenied: false,
      scope: null,
      localChannelId: null,
      viewers: 0
    });
  }
  registerScope(scope: NativeCaptureScope) {
    const changed =
      !this.knownScope ||
      this.knownScope.courseId !== scope.courseId ||
      this.knownScope.sessionId !== scope.sessionId ||
      this.knownScope.joinCode !== scope.joinCode;
    this.knownScope = { ...scope };
    if (!changed) return;
    this.pendingSnapshotSyncId = null;
    if (
      this.state.scope &&
      (this.state.scope.courseId !== scope.courseId ||
        this.state.scope.sessionId !== scope.sessionId)
    ) {
      this.activeRequestId = null;
      this.legacyTerminalErrorPending = false;
      this.awaitingSourceChoice = false;
      this.sourcePickerOpened = false;
      this.pendingChoicePermission = false;
      this.update({
        phase: "idle",
        stream: null,
        sourceName: "",
        surface: "monitor",
        sourceKind: undefined,
        captureExcludesRemote: undefined,
        previewFrame: undefined,
        captureMode: undefined,
        requestId: undefined,
        errorCode: undefined,
        error: null,
        paused: false,
        permissionPending: false,
        permissionDenied: false,
        viewers: 0,
        scope: null,
        localChannelId: null
      });
    }
    if (this.bound) this.refreshStatus();
  }
  refreshStatus = () => {
    if (!this.bound || !this.knownScope) return;
    let syncId = this.nextRequestId();
    while (syncId === this.activeRequestId || syncId === this.pendingSnapshotSyncId) {
      syncId = this.nextRequestId();
    }
    this.pendingSnapshotSyncId = syncId;
    nativeCommand("ready", { syncId });
  };
  private onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      this.refreshStatus();
    }
  };
  private adoptSnapshot(detail: Record<string, unknown>) {
    const knownScope = this.knownScope;
    if (
      !knownScope ||
      typeof detail.syncId !== "string" ||
      detail.syncId !== this.pendingSnapshotSyncId ||
      detail.courseId !== knownScope.courseId ||
      detail.sessionId !== knownScope.sessionId
    )
      return;
    this.pendingSnapshotSyncId = null;
    const phase = detail.phase;
    if (
      phase !== "idle" &&
      phase !== "choosing" &&
      phase !== "permission" &&
      phase !== "preview" &&
      phase !== "live" &&
      phase !== "paused" &&
      phase !== "error"
    )
      return;
    const eventCaptureMode =
      detail.captureMode === "system-window" ||
      detail.captureMode === "manual-window" ||
      detail.captureMode === "display"
        ? detail.captureMode
        : undefined;
    const requestId = typeof detail.requestId === "string" ? detail.requestId : null;
    if (phase === "idle") {
      if (requestId && requestId === this.activeRequestId && this.awaitingSourceChoice) {
        this.update({
          phase: "choosing",
          scope: knownScope,
          captureMode: eventCaptureMode ?? this.state.captureMode,
          requestId,
          permissionPending: this.pendingChoicePermission,
          permissionDenied: false,
          error: null,
          errorCode: undefined
        });
        return;
      }
      this.activeRequestId = null;
      this.legacyTerminalErrorPending = false;
      this.awaitingSourceChoice = false;
      this.sourcePickerOpened = false;
      this.pendingChoicePermission = false;
      this.update({
        phase: "idle",
        stream: null,
        sourceName: "",
        sourceKind: undefined,
        captureExcludesRemote: undefined,
        previewFrame: undefined,
        captureMode: undefined,
        requestId: undefined,
        errorCode: undefined,
        paused: false,
        error: null,
        permissionPending: false,
        permissionDenied: false,
        scope: null,
        localChannelId: null,
        viewers: 0
      });
      return;
    }
    this.activeRequestId = requestId;
    this.legacyTerminalErrorPending = false;
    this.awaitingSourceChoice = phase === "choosing" || phase === "permission";
    this.sourcePickerOpened = this.awaitingSourceChoice;
    this.pendingChoicePermission = phase === "permission" || detail.permissionPending === true;
    const sourceKind =
      detail.sourceKind === "window" ||
      detail.sourceKind === "application" ||
      detail.sourceKind === "display"
        ? detail.sourceKind
        : undefined;
    const mappedPhase =
      phase === "live" || phase === "paused"
        ? "publishing"
        : phase === "permission"
          ? "choosing"
          : phase;
    const previewFrame =
      typeof detail.frameUrl === "string" && detail.frameUrl.startsWith("data:image/jpeg;base64,")
        ? detail.frameUrl
        : undefined;
    this.update({
      phase: mappedPhase,
      scope: knownScope,
      stream: null,
      sourceName: typeof detail.sourceName === "string" ? detail.sourceName : "",
      sourceKind,
      surface: sourceKind === "display" ? "monitor" : sourceKind ? "window" : this.state.surface,
      captureExcludesRemote:
        typeof detail.captureExcludesRemote === "boolean"
          ? detail.captureExcludesRemote
          : undefined,
      previewFrame,
      captureMode: eventCaptureMode,
      requestId: requestId ?? undefined,
      errorCode: typeof detail.code === "string" ? detail.code : undefined,
      error: phase === "error" && typeof detail.message === "string" ? detail.message : null,
      paused: phase === "paused",
      permissionPending: this.pendingChoicePermission,
      permissionDenied:
        detail.code === "SCREEN_RECORDING_PERMISSION_REQUIRED" && eventCaptureMode === "display",
      localChannelId: null
    });
  }
  setPaused(paused: boolean) {
    if (this.state.paused === paused) return;
    nativeCommand("pause", { paused });
    this.update({ paused });
  }
  private nextRequestId(): string {
    try {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch {
      // Fall through to UUID construction on hosts without randomUUID support.
    }
    const bytes = new Uint8Array(16);
    try {
      if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
      else throw new Error("Secure random values are unavailable");
    } catch {
      this.requestSequence += 1;
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
      bytes[0] ^= this.requestSequence & 0xff;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
