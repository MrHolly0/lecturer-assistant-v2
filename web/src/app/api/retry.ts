import { ApiError } from "./http";

export function shouldRetryMutation(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false;
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

export function mutationRetryDelay(attempt: number) {
  return Math.min(600 * 2 ** attempt, 2000);
}
