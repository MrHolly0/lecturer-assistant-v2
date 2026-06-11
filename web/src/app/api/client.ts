import type { components } from "./schema";

export type SystemInfo = components["schemas"]["SystemInfo"];

export async function getSystemInfo(): Promise<SystemInfo> {
  const response = await fetch("/api/v1/system/info", {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`System info request failed with ${response.status}`);
  }

  return response.json() as Promise<SystemInfo>;
}
