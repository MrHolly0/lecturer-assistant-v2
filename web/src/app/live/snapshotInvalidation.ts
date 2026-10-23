/** Coalesces large WS snapshot invalidations into bounded, quiet HTTP reads. */
export function createSnapshotInvalidationReader(
  read: () => Promise<boolean>,
  currentVersion: () => number | undefined
) {
  let target = -1;
  let attempts = 0;
  let running = false;
  let stopped = false;
  let timer: number | undefined;
  let lastReadAt = -Infinity;
  const interval = 1000 + Math.floor(Math.random() * 250);

  const satisfied = () => (currentVersion() ?? -1) >= target;
  const schedule = () => {
    if (stopped || running || timer !== undefined || satisfied() || attempts >= 2) return;
    timer = window.setTimeout(
      () => {
        timer = undefined;
        void run();
      },
      Math.max(0, interval - (Date.now() - lastReadAt))
    );
  };
  const run = async () => {
    if (stopped || satisfied()) return;
    running = true;
    attempts += 1;
    lastReadAt = Date.now();
    let confirmed = false;
    try {
      // The hook also joins any initial/poll/resume request already in flight.
      confirmed = await read();
    } catch {
      // HTTP retry/backoff and the periodic authoritative read own recovery.
    } finally {
      running = false;
    }
    // An older in-flight read may predate the invalidation. Allow one bounded
    // follow-up; a stream of changes is coalesced and spread across clients.
    if (confirmed) schedule();
  };

  return {
    invalidate(version: number) {
      if (!Number.isSafeInteger(version) || version < 0 || stopped) return;
      if (version > target) {
        target = version;
        attempts = 0;
      }
      schedule();
    },
    dispose() {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    }
  };
}
