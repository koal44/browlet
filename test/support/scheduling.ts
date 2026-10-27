import { InternalPromise } from '../../src/infra/promises';
import type { TaskSourceKey, TimerHost } from '../../src/infra/tasks';

/** Test-host Promise observation and deferred work, controlled by the supplied timer host. */
export function createTestScheduling(timerHost: TimerHost) {
  const PromiseConstructor: typeof InternalPromise = class TestPromise<T> extends InternalPromise<T> {
    protected override observeNative(fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void): void {
      void this.backing.then(fulfilled, rejected).catch((error: unknown) => {
        timerHost.scheduleTimeout(0, () => { throw error; });
      });
    }
  };
  return {
    InternalPromise: PromiseConstructor,
    runInParallel: (steps: () => void) => { timerHost.scheduleTimeout(0, steps); },
    queueTask: (_source: TaskSourceKey, steps: () => void) => timerHost.scheduleTimeout(0, steps),
  };
}
