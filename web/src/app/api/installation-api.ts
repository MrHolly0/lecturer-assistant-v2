import { apiFetch } from "./http";
import type { components } from "./schema";
export type InstallationRelease = components["schemas"]["InstallationRelease"];
export type InstallationJob = components["schemas"]["InstallationJob"];
export type InstallationStatus = components["schemas"]["InstallationStatus"];
export async function getInstallationStatus(): Promise<InstallationStatus> {
  return (await apiFetch("/admin/installation")).json();
}
export async function requestInstallationUpdate(
  releaseId: string,
  key: string
): Promise<InstallationJob> {
  return (
    await apiFetch("/admin/installation/jobs", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ releaseId })
    })
  ).json();
}
export async function cancelInstallationUpdate(id: string): Promise<void> {
  await apiFetch(`/admin/installation/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}
export async function acknowledgeInstallationUpdate(id: string): Promise<void> {
  await apiFetch(`/admin/installation/jobs/${encodeURIComponent(id)}/acknowledge`, {
    method: "POST"
  });
}
