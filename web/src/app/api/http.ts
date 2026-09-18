import { expireStoredAuth, getStoredAuth } from "../auth";
import { refreshAuthSession } from "./refresh";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestInit extends RequestInit {
  skipAuthRefresh?: boolean;
}

export async function apiFetch(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const { skipAuthRefresh = false, ...requestInit } = init;
  const accessToken = getStoredAuth()?.accessToken ?? null;
  let response = await sendRequest(path, requestInit, accessToken);

  if (response.status === 401 && !skipAuthRefresh && accessToken) {
    const currentToken = getStoredAuth()?.accessToken ?? null;
    const refreshed =
      currentToken && currentToken !== accessToken ? true : await refreshAuthSession();
    if (refreshed) {
      response = await sendRequest(path, requestInit, getStoredAuth()?.accessToken ?? null);
    }
  }

  if (response.status === 401) {
    if (!skipAuthRefresh && accessToken) expireStoredAuth();
    throw new ApiError(401, "Сессия истекла");
  }
  await assertSuccessful(response);
  return response;
}

async function sendRequest(
  path: string,
  init: RequestInit,
  accessToken: string | null
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers
  });
}

async function assertSuccessful(response: Response): Promise<void> {
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
}
