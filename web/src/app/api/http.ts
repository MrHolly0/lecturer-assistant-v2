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
    let message = `Запрос завершился с ошибкой ${response.status}`;
    try {
      const data = (await response.clone().json()) as { message?: string; detail?: string };
      if (data?.message) message = data.message;
      else if (data?.detail) message = data.detail;
    } catch {
      // тело ответа не JSON — оставляем сообщение по умолчанию
    }
    throw new ApiError(response.status, message);
  }
  return response;
}
