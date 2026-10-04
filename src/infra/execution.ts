import { InternalPromise } from './promises';

/** Promise creation, background work, and task delivery for one execution owner. */
export interface AsyncExecution {
  /** Internal Promise constructor selecting creation and reaction delivery. */
  Promise: typeof InternalPromise;
  /** Schedule background steps without invoking them inline or entering an owner task. */
  runInParallel: (steps: () => void) => void;
  /** Queue timer work with the nesting level inherited by timers created inside it. */
  queueTask(source: 'timer', steps: () => void, options: TaskCreationOptions): TaskHandle;
  /** Queue a later task for this owner on the selected source. */
  queueTask(source: TaskSourceKey, steps: () => void): TaskHandle;
}

/** Compose standalone execution from native Promise reactions and supplied timer wake-ups. */
export function createAsyncExecution(timerHost: TimerHost): AsyncExecution {
  return {
    Promise: class AsyncPromise<T> extends InternalPromise<T> {
      protected override observeNative(fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void): void {
        void this.backing.then(fulfilled, rejected).catch((error: unknown) => {
          timerHost.scheduleTimeout(0, () => { throw error; });
        });
      }
    },
    runInParallel: (steps) => { timerHost.scheduleTimeout(0, steps); },
    queueTask: (_source, steps) => timerHost.scheduleTimeout(0, steps),
  };
}

/** Native timer wake-ups; callers own deadlines and task delivery. */
export interface TimerHost {
  /** Request one asynchronous wake-up; the host may limit the requested delay. */
  scheduleTimeout(milliseconds: number, steps: () => void): TaskHandle;
}

/** Use the captured native timer pair, requiring timers only when scheduling work. */
export const nativeTimerHost: TimerHost = {
  scheduleTimeout(milliseconds, steps) {
    const timer = nativeSetTimeout.call(nativeHost, steps, milliseconds);
    return { remove: () => { nativeClearTimeout.call(nativeHost, timer); } };
  },
};

/** Shared task sources understood by execution providers; hosts own their queues. */
export type TaskSourceKey = 'file' | 'network' | 'dom-manipulation' | 'report' | 'automation' | 'timer';

/** Metadata carried by a queued task. */
export type TaskCreationOptions = {
  /** Nesting level inherited by timers created inside this task; absent for other work. */
  timerNestingLevel?: number;
};

/** Handle for removing a task before it executes. */
export type TaskHandle = {
  remove(): void;
};

type NativeTimerGlobals = {
  setTimeout(steps: () => void, delay: number): NativeTimerHandle;
  clearTimeout(handle: NativeTimerHandle): void;
};

// Browsers return numeric IDs; Node returns objects. Only the captured pair
// uses these tokens; callers receive a TaskHandle.
type NativeTimerHandle = number | object;

const nativeHost = globalThis as typeof globalThis & NativeTimerGlobals;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the captured pair with its original host.
const { setTimeout: nativeSetTimeout, clearTimeout: nativeClearTimeout } = nativeHost;
