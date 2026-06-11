import type { components } from "./schema";
import { apiFetch } from "./http";

export type { ApiError } from "./http";
export type SystemInfo = components["schemas"]["SystemInfo"];

export async function getSystemInfo(): Promise<SystemInfo> {
  const res = await apiFetch("/system/info");
  return res.json() as Promise<SystemInfo>;
}
