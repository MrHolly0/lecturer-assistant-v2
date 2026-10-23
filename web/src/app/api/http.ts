import { expireStoredAuth, getStoredAuth } from "../auth";
import { invalidatePendingAuthRefresh } from "./refresh";
import { refreshAuthSession } from "./refresh";
import { apiErrorFromResponse } from "./errors";

export { ApiError } from "./errors";

export interface ApiRequestInit extends RequestInit {
  skipAuthorization?: boolean;
  skipAuthRefresh?: boolean;
}

let lastForbiddenRefreshAt = 0;

export async function apiFetch(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const { skipAuthorization = false, skipAuthRefresh = false, ...requestInit } = init;
  const accessToken = skipAuthorization ? null : getStoredAuth()?.accessToken ?? null;
  let responseToken = accessToken;
  let response = await sendRequest(path, requestInit, accessToken);

  const refreshForbidden = Boolean(
    response.status === 403 &&
      !skipAuthRefresh &&
      accessToken &&
      Date.now() - lastForbiddenRefreshAt > 60_000
  );
  if (refreshForbidden) lastForbiddenRefreshAt = Date.now();
  if ((response.status === 401 || refreshForbidden) && !skipAuthRefresh && accessToken) {
    const currentToken = getStoredAuth()?.accessToken ?? null;
    let refreshed: Awaited<ReturnType<typeof refreshAuthSession>> | true | null = null;
    try {
      if (currentToken && currentToken !== accessToken) {
        refreshed = true;
        responseToken = currentToken;
      } else {
        refreshed = await refreshAuthSession();
      }
    } catch (error) {
      // A recoverable refresh failure does not invalidate the existing session. For
      // a 403, preserve the authorization response; refreshing is only a best-effort
      // compatibility path for stale access tokens.
      if (response.status === 403) refreshed = null;
      else throw error;
    }
    if (refreshed) {
      requestInit.signal?.throwIfAborted();
      responseToken = getStoredAuth()?.accessToken ?? null;
      response = await sendRequest(path, requestInit, responseToken);
    }
  }

  if (response.status === 401) {
    requestInit.signal?.throwIfAborted();
    // Only expire the credentials that received this response. An older request
    // must not clear a token installed by a later login/account switch.
    if (!skipAuthRefresh && responseToken && getStoredAuth()?.accessToken === responseToken) {
      invalidatePendingAuthRefresh();
      expireStoredAuth();
    }
    throw await apiErrorFromResponse(response);
  }
  await assertSuccessful(response);
  return response;
}

/** Bound a complete read, including the response body, without retrying commands. */
export async function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  timeoutMs = 12_000
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(
    () => controller.abort(new DOMException("Request deadline exceeded", "TimeoutError")),
    timeoutMs
  );
  let rejectOnAbort: (() => void) | undefined;
  try {
    controller.signal.throwIfAborted();
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    const result = await Promise.race([request(controller.signal), cancelled]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    window.clearTimeout(timer);
    if (rejectOnAbort) controller.signal.removeEventListener("abort", rejectOnAbort);
    parentSignal?.removeEventListener("abort", abort);
  }
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
  if (!response.ok) throw await apiErrorFromResponse(response);
}
