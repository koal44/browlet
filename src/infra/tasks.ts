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

/** Shared task sources understood by environments; hosts own their queues. */
export type TaskSourceKey = 'file' | 'network' | 'dom-manipulation' | 'report' | 'automation' | 'timer';

/** Metadata carried by a queued task. */
export type TaskCreationOptions = {
  /** Additional readiness condition, such as a MessagePort queue being enabled. */
  isRunnable?: () => boolean;
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
