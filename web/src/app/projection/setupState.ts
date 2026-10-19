/** Screen identity is valid only for the current topology, never a stored hardware ID. */
export type DisplayGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ProjectionDisplay = DisplayGeometry & {
  id: string;
  label: string;
  availableLeft: number;
  availableTop: number;
  availableWidth: number;
  availableHeight: number;
  current: boolean;
};

export type ProjectionPhase =
  | "idle"
  | "requesting"
  | "unsupported"
  | "permission-denied"
  | "error"
  | "single-screen"
  | "choosing"
  | "opening"
  | "testing"
  | "placement-failed"
  | "popup-blocked"
  | "showing"
  | "invalidated"
  | "stopped";

export type ProjectionSnapshot = {
  phase: ProjectionPhase;
  screens: ProjectionDisplay[];
  selectedId: string | null;
  attemptId: string | null;
  testCode: string | null;
  message: string | null;
  placementVerified: boolean;
  fullscreen: boolean;
};

export const initialProjectionSnapshot: ProjectionSnapshot = {
  phase: "idle",
  screens: [],
  selectedId: null,
  attemptId: null,
  testCode: null,
  message: null,
  placementVerified: false,
  fullscreen: false
};

export function displayId(screen: DisplayGeometry): string {
  return [screen.left, screen.top, screen.width, screen.height].join(":");
}

export function topologyId(screens: DisplayGeometry[], current: DisplayGeometry): string {
  return `${screens.map(displayId).sort().join("|")}@${displayId(current)}`;
}

export function canConfirmProjection(snapshot: ProjectionSnapshot): boolean {
  return (
    snapshot.phase === "testing" &&
    snapshot.placementVerified &&
    !!snapshot.attemptId &&
    !!snapshot.selectedId &&
    snapshot.screens.some((screen) => screen.id === snapshot.selectedId && !screen.current)
  );
}

export function selectProjectionScreen(
  snapshot: ProjectionSnapshot,
  screenId: string
): ProjectionDisplay | null {
  return snapshot.screens.find((screen) => screen.id === screenId && !screen.current) ?? null;
}

export function isProjectionMessage(value: unknown, attemptId: string): value is ProjectionMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.protocol !== "la-projector-v1" || item.attemptId !== attemptId) return false;
  if (
    item.type === "hello" ||
    item.type === "neutral" ||
    item.type === "show" ||
    item.type === "lease"
  )
    return true;
  if (item.type !== "position") return false;
  return (
    typeof item.screenId === "string" &&
    item.screenId.length < 200 &&
    typeof item.fullscreen === "boolean"
  );
}

export type ProjectionMessage = {
  protocol: "la-projector-v1";
  attemptId: string;
  type: "hello" | "position" | "neutral" | "show" | "lease";
  screenId?: string;
  fullscreen?: boolean;
};
