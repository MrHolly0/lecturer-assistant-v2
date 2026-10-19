import { apiFetch } from "../api/http";

type Theme = "light" | "dark";
const updates = new Map<string, { theme: Theme; pending: Promise<void> }>();

/** Keep rapid theme changes ordered; a late response must not restore an older theme. */
export function syncProjectionAppearance(
  deviceId: string,
  theme: Theme,
  { force = false }: { force?: boolean } = {}
): Promise<void> {
  const previous = updates.get(deviceId);
  if (!force && previous?.theme === theme) return previous.pending;
  const pending = (previous?.pending ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      await apiFetch(`/projection/devices/${encodeURIComponent(deviceId)}/appearance`, {
        method: "PUT",
        body: JSON.stringify({ theme })
      });
    });
  updates.set(deviceId, { theme, pending });
  void pending.catch(() => {
    if (updates.get(deviceId)?.pending === pending) updates.delete(deviceId);
  });
  return pending;
}
