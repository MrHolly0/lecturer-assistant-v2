const selected = new Map<string, string>();
const uuid = /^[a-f0-9-]{36}$/i;

function key(courseId: string, sessionId: string) {
  return `la_projector_device_v1:${courseId}/${sessionId}`;
}

/** A UI preference only. The server still checks ownership and the exact live output lease. */
export function rememberNativeProjectionDevice(
  courseId: string,
  sessionId: string,
  deviceId: string
) {
  if (![courseId, sessionId, deviceId].every((value) => uuid.test(value))) return;
  const storageKey = key(courseId, sessionId);
  selected.set(storageKey, deviceId);
  try {
    sessionStorage.setItem(storageKey, deviceId);
  } catch {
    // In-memory selection is enough while this page remains open.
  }
}

export function preferredNativeProjectionDevice(
  courseId: string,
  sessionId: string
): string | null {
  const storageKey = key(courseId, sessionId);
  try {
    const value = sessionStorage.getItem(storageKey);
    if (value && uuid.test(value)) return value;
  } catch {
    // Private browsing can disable storage.
  }
  return selected.get(storageKey) ?? null;
}
