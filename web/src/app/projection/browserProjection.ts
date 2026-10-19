import {
  canConfirmProjection,
  displayId,
  initialProjectionSnapshot,
  isProjectionMessage,
  selectProjectionScreen,
  topologyId,
  type DisplayGeometry,
  type ProjectionDisplay,
  type ProjectionMessage,
  type ProjectionSnapshot
} from "./setupState";

export type DetailedScreen = Screen &
  EventTarget &
  DisplayGeometry & {
    label?: string;
    availLeft: number;
    availTop: number;
  };
export type ScreenDetails = EventTarget & {
  screens: DetailedScreen[];
  currentScreen: DetailedScreen;
};
export type ProjectionWindow = Window & { getScreenDetails?: () => Promise<ScreenDetails> };

/** No staff state, token, questions or drafts cross this channel. */
class BrowserProjection {
  private snapshot: ProjectionSnapshot = initialProjectionSnapshot;
  private listeners = new Set<() => void>();
  private details: ScreenDetails | null = null;
  private topology = "";
  private popup: Window | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastPosition = 0;
  private deadline = 0;
  private materialAvailable = false;
  private listenersInstalled = false;
  private permission: PermissionStatus | null = null;
  private screenListeners = new Set<DetailedScreen>();

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ProjectionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private installListeners() {
    if (this.listenersInstalled) return;
    this.listenersInstalled = true;
    window.addEventListener("message", this.receive);
    window.addEventListener("focus", this.refresh);
    window.addEventListener("pagehide", this.closeForPageExit);
  }

  async requestScreens() {
    this.installListeners();
    if (this.snapshot.attemptId) {
      this.closeWindow();
      this.update({ attemptId: null, selectedId: null, placementVerified: false, testCode: null });
    }
    const host = window as ProjectionWindow;
    if (!window.isSecureContext || typeof host.getScreenDetails !== "function") {
      this.update({ phase: "unsupported", message: null });
      return;
    }
    this.update({ phase: "requesting", message: null });
    try {
      const details = await host.getScreenDetails();
      if (this.details !== details) {
        this.details?.removeEventListener("screenschange", this.refresh);
        this.details?.removeEventListener("currentscreenchange", this.refresh);
        this.details = details;
        details.addEventListener("screenschange", this.refresh);
        details.addEventListener("currentscreenchange", this.refresh);
      }
      this.refresh();
      this.update({
        phase: this.snapshot.screens.some((screen) => !screen.current)
          ? "choosing"
          : "single-screen"
      });
      try {
        this.permission?.removeEventListener("change", this.permissionChanged);
        this.permission = await navigator.permissions.query({
          name: "window-management" as PermissionName
        });
        this.permission.addEventListener("change", this.permissionChanged);
      } catch {
        // Permission querying is optional. getScreenDetails is the authoritative request.
      }
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.update({
        phase: denied ? "permission-denied" : "error",
        message: denied ? null : "Браузер не смог получить экраны. Попробуйте ещё раз."
      });
    }
  }

  private permissionChanged = () => {
    if (this.permission?.state !== "granted") {
      this.neutralize();
      this.update({ phase: "permission-denied", placementVerified: false, selectedId: null });
    }
  };

  private refresh = () => {
    if (!this.details) return;
    const { screens, currentScreen } = this.details;
    const nextTopology = topologyId(screens, currentScreen);
    const changed = this.topology !== "" && nextTopology !== this.topology;
    this.topology = nextTopology;
    for (const previous of this.screenListeners) {
      if (!screens.includes(previous)) {
        previous.removeEventListener("change", this.refresh);
        this.screenListeners.delete(previous);
      }
    }
    for (const screen of screens) {
      if (!this.screenListeners.has(screen)) {
        this.screenListeners.add(screen);
        screen.addEventListener("change", this.refresh);
      }
    }
    const mapped: ProjectionDisplay[] = screens.map((screen, index) => ({
      id: displayId(screen),
      label: screen.label?.trim() || `Экран ${index + 1}`,
      left: screen.left,
      top: screen.top,
      width: screen.width,
      height: screen.height,
      availableLeft: screen.availLeft,
      availableTop: screen.availTop,
      availableWidth: screen.availWidth,
      availableHeight: screen.availHeight,
      current: displayId(screen) === displayId(currentScreen)
    }));
    if (changed && this.snapshot.attemptId) {
      this.neutralize();
      this.update({
        phase: "invalidated",
        screens: mapped,
        selectedId: null,
        placementVerified: false,
        message: "Набор экранов или рабочий экран изменился. Повторите проверку проектора."
      });
    } else {
      this.update({ screens: mapped });
      if (["single-screen", "choosing"].includes(this.snapshot.phase)) {
        this.update({
          phase: mapped.some((screen) => !screen.current) ? "choosing" : "single-screen"
        });
      }
    }
  };

  /** Must run directly in a click handler, after requestScreens has completed. */
  openTest(screenId: string, joinCode: string) {
    this.installListeners();
    this.refresh();
    const screen = selectProjectionScreen(this.snapshot, screenId);
    if (!screen || !/^[a-zA-Z0-9_-]{1,64}$/.test(joinCode)) {
      this.update({ phase: "error", message: "Выберите другой доступный экран и занятие." });
      return;
    }
    this.closeWindow();
    this.materialAvailable = joinCode !== "setup";
    const attemptId = crypto.randomUUID();
    const testCode = String((crypto.getRandomValues(new Uint32Array(1))[0] % 9000) + 1000);
    this.update({
      phase: "opening",
      selectedId: screenId,
      attemptId,
      testCode,
      placementVerified: false,
      fullscreen: false,
      message: null
    });
    const query = new URLSearchParams({ attempt: attemptId, testCode });
    const url = `${window.location.origin}${window.location.pathname}#/projection/${encodeURIComponent(joinCode)}?${query}`;
    this.popup = window.open(
      url,
      `lecturer-projector-${attemptId}`,
      `popup,left=${screen.availableLeft},top=${screen.availableTop},width=${screen.availableWidth},height=${screen.availableHeight}`
    );
    if (!this.popup) {
      this.update({ phase: "popup-blocked" });
      return;
    }
    try {
      this.popup.moveTo(screen.availableLeft, screen.availableTop);
      this.popup.resizeTo(screen.availableWidth, screen.availableHeight);
    } catch {
      // Receiver reports the actual screen. A requested placement alone is not success.
    }
    this.deadline = Date.now() + 12000;
    this.lastPosition = Date.now();
    this.ticker = setInterval(this.tick, 1000);
  }

  private receive = (event: MessageEvent) => {
    const { attemptId } = this.snapshot;
    if (
      !attemptId ||
      event.origin !== window.location.origin ||
      event.source !== this.popup ||
      !isProjectionMessage(event.data, attemptId)
    )
      return;
    const message = event.data;
    if (message.type === "hello") {
      if (this.snapshot.phase === "showing")
        this.update({
          phase: "invalidated",
          placementVerified: false,
          message: "Окно проектора перезагрузилось. Повторите проверку."
        });
      this.send("neutral");
      return;
    }
    if (message.type !== "position") return;
    this.lastPosition = Date.now();
    const matches =
      message.screenId === this.snapshot.selectedId &&
      this.snapshot.screens.some((screen) => screen.id === message.screenId && !screen.current);
    if (!matches) {
      this.neutralize();
      this.update({
        phase: this.snapshot.phase === "showing" ? "invalidated" : "placement-failed",
        placementVerified: false,
        fullscreen: !!message.fullscreen,
        message: "Тест оказался на другом экране. Выберите экран и повторите проверку."
      });
      return;
    }
    if (this.snapshot.phase === "opening")
      this.update({ phase: "testing", placementVerified: true });
    this.update({ fullscreen: !!message.fullscreen });
    // The visible receiver also drives the lease. Timer throttling of an inactive
    // controller tab must not blank a still connected physical projection.
    if (this.snapshot.phase === "showing") this.send("lease");
  };

  private tick = () => {
    if (this.popup?.closed) {
      this.closeWindow();
      this.update({
        phase: "stopped",
        placementVerified: false,
        message: "Окно проектора закрыто. Занятие продолжается."
      });
      return;
    }
    if (this.snapshot.phase === "opening" && Date.now() > this.deadline) {
      this.neutralize();
      this.update({
        phase: "placement-failed",
        placementVerified: false,
        message: "Браузер не подтвердил размещение. Разрешите управление окнами и повторите тест."
      });
    } else if (this.snapshot.phase === "showing" && Date.now() - this.lastPosition > 6500) {
      this.neutralize();
      this.update({
        phase: "invalidated",
        placementVerified: false,
        message: "Потеряна связь с окном проектора. Повторите проверку."
      });
    }
    if (this.snapshot.phase === "showing") this.send("lease");
  };

  confirmTest(): boolean {
    this.refresh();
    if (
      !canConfirmProjection(this.snapshot) ||
      Date.now() - this.lastPosition > 4000 ||
      this.popup?.closed
    )
      return false;
    this.update({ phase: "showing" });
    this.send(this.materialAvailable ? "show" : "neutral");
    try {
      localStorage.setItem("la_projector_training_seen", "1");
    } catch {
      /* Optional preference only. */
    }
    return true;
  }

  private send(type: ProjectionMessage["type"]) {
    if (!this.snapshot.attemptId || !this.popup || this.popup.closed) return;
    this.popup.postMessage(
      {
        protocol: "la-projector-v1",
        attemptId: this.snapshot.attemptId,
        type
      } satisfies ProjectionMessage,
      window.location.origin
    );
  }
  private neutralize() {
    this.send("neutral");
  }
  private closeWindow() {
    this.neutralize();
    this.popup?.close();
    this.popup = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }
  private closeForPageExit = () => this.closeWindow();
  selectScreen() {
    this.closeWindow();
    this.update({
      phase: "choosing",
      attemptId: null,
      placementVerified: false,
      selectedId: null,
      testCode: null,
      message: null
    });
  }
  stop() {
    this.closeWindow();
    this.update({
      phase: "stopped",
      attemptId: null,
      placementVerified: false,
      selectedId: null,
      testCode: null,
      message: null
    });
  }
}

export const browserProjection = new BrowserProjection();
