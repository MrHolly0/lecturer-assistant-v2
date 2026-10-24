import { isRetryableError, retryDelayMs } from "../api/retry";

interface Delivery {
  sessionId: string;
  status: string;
  kicked?: boolean;
}

/** Receipt-driven: an open tab or a local timer is not evidence of a working connection. */
export function trackStudentDelivery(
  send: (sessionId: string, completed: boolean, signal: AbortSignal) => Promise<void>
) {
  let latest: Delivery | null = null;
  let deliveredAt = 0;
  let observedRunning = false;
  let completed = false;
  let stopped = false;
  let pending = false;
  let failures = 0;
  let notBefore = 0;
  let timer: number | undefined;
  let controller: AbortController | null = null;

  const schedule = (delay: number) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
  };

  async function flush() {
    if (pending || !latest || (stopped && !completed)) return;
    // A suspended page must not acknowledge stale queued heartbeats after waking.
    if (!completed && (Date.now() - deliveredAt > 20_000 || !navigator.onLine)) return;
    if (Date.now() < notBefore) {
      schedule(notBefore - Date.now());
      return;
    }
    pending = true;
    const sendingEnd = completed;
    controller = new AbortController();
    notBefore = Date.now() + 30_000 + Math.floor(Math.random() * 5000);
    try {
      await send(latest.sessionId, sendingEnd, controller.signal);
      failures = 0;
      if (sendingEnd) stopped = true;
    } catch (error) {
      if (!isRetryableError(error)) {
        stopped = true;
      } else {
        const delay = retryDelayMs(failures++, {
          baseMs: completed ? 2000 : 10_000,
          maxMs: completed ? 8000 : 60_000,
          error
        });
        notBefore = Date.now() + delay;
        // Only completion is retried without another delivery, with a finite budget.
        if (completed && failures < 3) schedule(delay);
        else if (completed) stopped = true;
      }
    } finally {
      pending = false;
      controller = null;
      // The terminal frame may arrive while the previous ordinary receipt is in flight.
      if (completed && !sendingEnd && !stopped) {
        notBefore = 0;
        schedule(0);
      }
    }
  }

  return {
    received(snapshot: Delivery) {
      if (stopped || completed || snapshot.kicked) return;
      if (latest && latest.sessionId !== snapshot.sessionId) return;
      latest = snapshot;
      deliveredAt = Date.now();
      if (snapshot.status === "ENDED" || snapshot.status === "ARCHIVED") {
        if (!observedRunning) return; // Opening old results is not staying until the end.
        completed = true;
        notBefore = 0;
        schedule(0);
      } else {
        observedRunning = true;
        if (!pending && timer === undefined) {
          schedule(Math.max(Math.floor(Math.random() * 2000), notBefore - Date.now()));
        }
      }
    },
    stop() {
      if (completed) return; // Let the bounded, token-scoped final receipt finish after UI teardown.
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    }
  };
}
