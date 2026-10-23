import { ApiError } from "./errors";

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError)
    return (
      error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500
    );
  if (error instanceof Error && error.name === "AbortError") return false;
  return (
    error instanceof TypeError ||
    (error instanceof Error && ["TimeoutError", "RefreshUnavailableError"].includes(error.name))
  );
}

/** Equal jitter avoids both synchronized clients and immediate retry loops. */
export function retryDelayMs(
  attempt: number,
  {
    baseMs = 600,
    maxMs = 30_000,
    error,
    random = Math.random
  }: { baseMs?: number; maxMs?: number; error?: unknown; random?: () => number } = {}
): number {
  const cap = Math.min(baseMs * 2 ** Math.min(Math.max(0, attempt), 30), maxMs);
  const spread = Math.max(0, Math.min(1, random()));
  const delay = Math.ceil(cap * (0.5 + spread * 0.5));
  const retryAfter = error instanceof ApiError ? error.retryAfterMs : undefined;
  return retryAfter === undefined
    ? delay
    : Math.max(delay, retryAfter + Math.ceil(spread * Math.min(1000, cap * 0.5)));
}

export function shouldRetryRead(failureCount: number, error: unknown) {
  return failureCount < 2 && isRetryableError(error);
}

export function readRetryDelay(attempt: number, error?: unknown) {
  return retryDelayMs(attempt, { error });
}

export function shouldRetryMutation(failureCount: number, error: unknown) {
  return failureCount < 2 && isRetryableError(error);
}

export function mutationRetryDelay(attempt: number, error?: unknown) {
  return retryDelayMs(attempt, { maxMs: 2000, error });
}
