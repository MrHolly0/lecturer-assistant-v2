import type { ProjectionDevice } from "../api/projection-api";

export type HelperWizardStep =
  | "prepare"
  | "identify"
  | "confirm"
  | "waiting"
  | "manage"
  | "stopped";

type HelperDeviceState = Pick<
  ProjectionDevice,
  "connected" | "activeSessionId" | "status" | "screens" | "lastSeenAt"
>;

export function helperShowAcknowledged(
  requestedAt: number | null,
  device: HelperDeviceState,
  context: { sessionId: string; active: boolean } | null
): boolean {
  return Boolean(
    requestedAt !== null &&
      context?.active &&
      device.connected &&
      device.activeSessionId === context.sessionId &&
      device.status === "SHOWING" &&
      Date.parse(device.lastSeenAt ?? "") >= requestedAt
  );
}

/**
 * Local wizard progress is subordinate to the helper's latest server snapshot.
 * A restarted helper reports IDLE; stale local confirmation/manage controls must
 * never survive that transition.
 */
export function reconcileHelperWizardStep(
  step: HelperWizardStep,
  device: HelperDeviceState,
  context: { sessionId: string; active: boolean } | null
): HelperWizardStep | null {
  const showingForThisSession = Boolean(
    context?.active &&
      device.connected &&
      device.activeSessionId === context.sessionId &&
      (device.status === "SHOWING" || device.status === "PAUSED")
  );

  if (step === "waiting") {
    if (!device.connected || !context?.active) return "prepare";
    return null;
  }
  if (showingForThisSession) return step === "stopped" ? null : "manage";
  if (step === "confirm") {
    if (!device.connected || !context?.active || device.status === "ERROR")
      return device.connected && context?.active && device.screens.length > 1
        ? "identify"
        : "prepare";
    return null;
  }
  if (!["waiting", "manage", "stopped"].includes(step)) return null;

  if (!device.connected || !context?.active) return "prepare";
  return device.screens.length > 1 ? "identify" : "prepare";
}
