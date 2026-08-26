import type { UnsafeMoment } from '../performance/clock';
import { unsafeSharedCurrentTime } from '../performance/high-resolution-time';

/*
 * Node does not expose V8's shared microtask queue through a supported
 * synchronous API. Keep the provisional compatibility bridge at this host
 * boundary so HTML's event-loop algorithm does not depend on Node internals.
 *
 * https://github.com/nodejs/node/issues/65555
 */
export const nodeSchedulerHost: SchedulerHost = {
  requestEventLoopTurn(steps) {
    setImmediate(steps);
  },

  unsafeSharedCurrentTime,

  performMicrotaskCheckpoint() {
    /*
     * This drains Node's ambient V8 queue and also processes next-tick and
     * promise-rejection machinery. It is suitable only for Browlet's current
     * controlled single-scheduler host and is not an isolation boundary.
     */
    getTickCallback()();
  },
};

export type SchedulerHost = {
  /* Invoke steps from a later host task, never synchronously. */
  requestEventLoopTurn(this: void, steps: () => void): void;
  unsafeSharedCurrentTime(this: void): UnsafeMoment;
  performMicrotaskCheckpoint(this: void): void;
};

let tickCallback: (() => void) | undefined;

function getTickCallback(): () => void {
  if (tickCallback !== undefined) return tickCallback;

  const candidate: unknown = Reflect.get(process, '_tickCallback');
  if (typeof candidate !== 'function') {
    throw new Error(
      'Node does not expose the provisional microtask checkpoint bridge',
    );
  }

  tickCallback = () => { Reflect.apply(candidate, process, []); };
  return tickCallback;
}
