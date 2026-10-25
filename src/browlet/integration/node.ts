import { InternalPromise, type TimerHost } from '../../infra/index';

// HTML section 2.1.1 permits cooperative scheduling. Captured closures stay
// in this isolate; true worker parallelism needs algorithm-specific data and
// message boundaries rather than a different implementation of this primitive.
/** Queue work on a later Node turn, without entering an HTML event loop. */
export function queueNodeTask(steps: () => void): void {
  setImmediate(steps);
}

/** Native wake-ups for HTML timers, which retain and recheck their own deadlines. */
export const nodeTimerHost: TimerHost = {
  scheduleTimeout(milliseconds, steps) {
    // Node clamps larger delays to one millisecond; wake in bounded chunks.
    const delay = Math.min(milliseconds, 2_147_483_647);
    const handle = setTimeout(steps, delay);
    return { remove: () => { clearTimeout(handle); } };
  },
};

/** Internal continuations for browser-owned work that has no HTML realm. */
// Page implementations use their environment's execution facilities instead.
export class NodePromise<T> extends InternalPromise<T> {
  protected override observeNative(fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void): void {
    void this.backing.then(fulfilled, rejected).catch((error: unknown) => {
      queueNodeTask(() => { throw error; });
    });
  }
}
