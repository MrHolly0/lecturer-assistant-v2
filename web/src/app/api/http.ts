import { clearStoredAuth, getStoredAuth } from "../auth";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = getStoredAuth();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (auth) {
    headers.set("Authorization", `Bearer ${auth.accessToken}`);
  }
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers
  });
  if (response.status === 401) {
    clearStoredAuth();
    window.dispatchEvent(new CustomEvent("auth:expired"));
    throw new ApiError(401, "Сессия истекла");
  }
  if (!response.ok) {
    throw new ApiError(response.status, `Запрос завершился с ошибкой ${response.status}`);
  }
  return response;
}
