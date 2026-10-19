import { apiFetch } from "./http";
import type { components } from "./schema";

export type ProjectionDevice = components["schemas"]["ProjectionDevice"];
export type ProjectionSettings = components["schemas"]["ProjectionSettings"];
export type ProjectionPolicyUpdate = components["schemas"]["ProjectionPolicyUpdate"];
export type ProjectionPairing = components["schemas"]["ProjectionPairing"];
export type ProjectionCommand = components["schemas"]["ProjectionCommand"];
export type ProjectionCommandRequest = components["schemas"]["ProjectionCommandRequest"];

export async function getProjectionSettings(): Promise<ProjectionSettings> {
  return (await apiFetch("/projection/settings")).json();
}
export async function saveProjectionPolicy(
  request: ProjectionPolicyUpdate
): Promise<ProjectionSettings> {
  return (
    await apiFetch("/admin/projection/policy", {
      method: "PUT",
      body: JSON.stringify(request)
    })
  ).json();
}
export async function createProjectionPairing(): Promise<ProjectionPairing> {
  return (await apiFetch("/projection/pairings", { method: "POST" })).json();
}
export async function revokeProjectionDevice(id: string): Promise<void> {
  await apiFetch(`/projection/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendProjectionCommand(
  courseId: string,
  sessionId: string,
  request: ProjectionCommandRequest
): Promise<ProjectionCommand> {
  return (
    await apiFetch(
      `/courses/${encodeURIComponent(courseId)}/sessions/${encodeURIComponent(sessionId)}/projection/commands`,
      { method: "POST", body: JSON.stringify(request) }
    )
  ).json();
}
