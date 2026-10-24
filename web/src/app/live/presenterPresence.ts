import { isRetryableError, retryDelayMs } from "../api/retry";

/** Each presenter/remote renews independently, including while its tab is hidden. */
export function startPresenterPresence(ping: (signal: AbortSignal) => Promise<void>) {
  let stopped = false;
  let pending = false;
  let timer: number | undefined;
  let controller: AbortController | null = null;
  let failures = 0;
  let lastStarted = -Infinity;

  const stop = () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    controller?.abort();
    window.removeEventListener("online", wake);
    window.removeEventListener("pageshow", wake);
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", wake);
  };

  async function pulse() {
    if (stopped || pending) return;
    if (timer !== undefined) window.clearTimeout(timer);
    pending = true;
    lastStarted = Date.now();
    controller = new AbortController();
    let delay: number;
    try {
      await ping(controller.signal);
      failures = 0;
      delay = 60_000 + Math.floor(Math.random() * 10_000);
    } catch (error) {
      if (stopped) return;
      if (!isRetryableError(error)) {
        stop();
        return;
      }
      delay = retryDelayMs(failures++, { baseMs: 10_000, maxMs: 60_000, error });
    } finally {
      pending = false;
      controller = null;
    }
    if (!stopped) timer = window.setTimeout(() => void pulse(), delay);
  }

  function wake() {
    if (Date.now() - lastStarted >= 5000) void pulse();
  }

  window.addEventListener("online", wake);
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
  void pulse();
  return stop;
}
