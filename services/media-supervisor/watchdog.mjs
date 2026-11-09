/** Pure state machine; only this supervisor owns the child process it can terminate. */
import { monotonicEpoch } from '../common/runtime.mjs';
export class SfuWatchdog {
  constructor({ start, stop, now = monotonicEpoch }) {
    Object.assign(this, { start, stop, now });
    this.child = null; this.validUntil = 0; this.nextStart = 0;
  }
  renew(until, bootstrap = false) {
    const now = this.now();
    if (!Number.isFinite(until) || until <= now || until > now + 5000) return false;
    if (bootstrap && this.child) return true;
    if (!this.child && now >= this.nextStart) this.child = this.start();
    if (this.child) this.validUntil = until;
    return true;
  }
  tick() {
    if (this.child && this.now() >= this.validUntil) {
      const child = this.child; this.child = null; this.validUntil = 0; this.nextStart = this.now() + 10000;
      this.stop(child);
    }
  }
  exited(child) {
    if (this.child === child) { this.child = null; this.validUntil = 0; this.nextStart = this.now() + 10000; }
  }
}
