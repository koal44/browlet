import type { TaskHandle } from '../../../infra/index';
import {
  arg, defineCallbackFunction, defineDictionary, defineInterface, definePartialInterface,
  dictMember, emptyDictionary, idlType, impl, onError, op, reference, roAttr,
} from '../../../web-idl/core/index';

import { unsafeSharedCurrentTime, type Moment } from '../../timing/index';
import { idleTaskSource } from '../../scripting/index';
import type { WindowEnvironment } from '../../environment/index';

/** Owns one Window's idle registrations, periods, and timeout races. */
export class WindowIdleCallbacks {
  /** Registrations made since the most recent idle period began. */
  #idleRequestCallbacks = new Map<number, IdleRequest>();
  /** FIFO registrations eligible in the current idle period. */
  #runnableIdleCallbacks = new Map<number, IdleRequest>();
  /** Monotonically increasing registration identifier, as specified. */
  #idleCallbackIdentifier = 0;
  /** Deadline retained until this Window may enter another idle period. */
  #idleDeadline: (() => Moment) | null = null;
  /** At most one delivery task and one next-period wake-up per Window. */
  #idleTaskQueued = false;
  #idlePeriodWakeUp: TaskHandle | null = null;
  /** Window environment supplying scheduling, clock precision, and task ownership. */
  #env: WindowEnvironment;

  constructor(env: WindowEnvironment) {
    this.#env = env;
  }

  /** Whether this Window still has work to offer at an idle boundary. */
  get hasPending(): boolean {
    return this.#idleRequestCallbacks.size !== 0 || this.#runnableIdleCallbacks.size !== 0;
  }

  // https://w3c.github.io/requestidlecallback/#the-requestidlecallback-method
  request(callback: IdleRequestCallback, options: IdleRequestOptions): number {
    const handle = ++this.#idleCallbackIdentifier;
    const request: IdleRequest = { callback, timeoutAt: null, timer: null };
    this.#idleRequestCallbacks.set(handle, request);
    const timeout = options.timeout;
    if (timeout !== undefined && timeout > 0) {
      // This specification waits elapsed time, unlike HTML's active-time timers.
      // The resulting HTML task still observes Document activity at delivery.
      request.timeoutAt = unsafeSharedCurrentTime().milliseconds + timeout;
      request.timer = this.#env.userAgent.timerHost.scheduleTimeout(timeout, () => { this.#idleTimeoutReached(handle); });
    }
    this.#env.responsibleEventLoop.requestIdlePeriod();
    return handle;
  }

  // https://w3c.github.io/requestidlecallback/#the-cancelidlecallback-method
  cancel(handle: number): void {
    const request = this.#idleRequestCallbacks.get(handle) ?? this.#runnableIdleCallbacks.get(handle);
    request?.timer?.remove();
    this.#idleRequestCallbacks.delete(handle);
    this.#runnableIdleCallbacks.delete(handle);
    if (this.#idleRequestCallbacks.size === 0 && this.#runnableIdleCallbacks.size === 0) {
      this.#idlePeriodWakeUp?.remove();
      this.#idlePeriodWakeUp = null;
    }
  }

  /** Move the current pending batch into the runnable list, then queue delivery. */
  // https://w3c.github.io/requestidlecallback/#start-an-idle-period-algorithm
  // The existing HTML deadline callback returns a coarsened Moment, not a raw number.
  startIdlePeriod(getDeadline: () => Moment): void {
    if (
      this.#idleTaskQueued ||
      (this.#idleRequestCallbacks.size === 0 && this.#runnableIdleCallbacks.size === 0) ||
      !this.#env.isAssociatedDocumentFullyActive()
    ) return;
    const now = unsafeSharedCurrentTime().milliseconds;
    const remaining = (this.#idleDeadline?.().milliseconds ?? 0) - now;
    if (remaining > 0) {
      // A callback posted during this period waits for the next one. One real
      // deadline wake-up replaces repeated empty tasks or timer polling.
      if (this.#idlePeriodWakeUp === null) {
        this.#idlePeriodWakeUp = this.#env.userAgent.timerHost.scheduleTimeout(remaining, () => {
          this.#idlePeriodWakeUp = null;
          this.#env.responsibleEventLoop.requestIdlePeriod();
        });
      }
      return;
    }
    if (getDeadline().milliseconds <= now) return;
    this.#idlePeriodWakeUp?.remove();
    this.#idlePeriodWakeUp = null;
    this.#idleDeadline = getDeadline;
    for (const [handle, request] of this.#idleRequestCallbacks) this.#runnableIdleCallbacks.set(handle, request);
    this.#idleRequestCallbacks.clear();
    this.#queueIdleCallback(getDeadline);
  }

  /** Release pending callbacks and wake-ups when this Document cannot be restored. */
  clear(): void {
    for (const request of this.#idleRequestCallbacks.values()) request.timer?.remove();
    for (const request of this.#runnableIdleCallbacks.values()) request.timer?.remove();
    this.#idleRequestCallbacks.clear();
    this.#runnableIdleCallbacks.clear();
    this.#idlePeriodWakeUp?.remove();
    this.#idlePeriodWakeUp = null;
  }

  // https://w3c.github.io/requestidlecallback/#invoke-idle-callbacks-algorithm
  #queueIdleCallback(getDeadline: () => Moment): void {
    this.#idleTaskQueued = true;
    this.#env.realm.queueGlobalTask(idleTaskSource, () => {
      this.#idleTaskQueued = false;
      // End this period early when ordinary work has become runnable.
      if (this.#env.responsibleEventLoop.hasRunnableTasks(idleTaskSource)) return;
      if (unsafeSharedCurrentTime().milliseconds >= getDeadline().milliseconds) return;
      const entry = this.#runnableIdleCallbacks.entries().next().value;
      if (entry === undefined) return;
      const [handle, request] = entry;
      this.#runnableIdleCallbacks.delete(handle);
      request.timer?.remove();
      const callback = request.callback;
      callback(new IdleDeadlineImpl(getDeadline, false, this.#env));
      if (this.#runnableIdleCallbacks.size !== 0) this.#queueIdleCallback(getDeadline);
    });
  }

  /** Finish elapsed waits in deadline order, even if host timers arrive out of order. */
  #idleTimeoutReached(handle: number): void {
    const request = this.#idleRequestCallbacks.get(handle) ?? this.#runnableIdleCallbacks.get(handle);
    if (request?.timeoutAt === null || request === undefined) return;
    const now = unsafeSharedCurrentTime().milliseconds;
    if (now < request.timeoutAt) {
      request.timer = this.#env.userAgent.timerHost.scheduleTimeout(request.timeoutAt - now, () => {
        this.#idleTimeoutReached(handle);
      });
      return;
    }
    const due = [...this.#idleRequestCallbacks, ...this.#runnableIdleCallbacks]
      .filter(([, entry]) => entry.timeoutAt !== null && entry.timeoutAt <= now);
    // Earlier absolute expiries precede later ones; registration order breaks ties.
    due.sort(([a, first], [b, second]) => first.timeoutAt! - second.timeoutAt! || a - b);
    for (const [id, entry] of due) {
      entry.timer?.remove();
      entry.timer = null;
      entry.timeoutAt = null;
      this.#env.realm.queueGlobalTask(idleTaskSource, () => { this.#invokeIdleCallbackTimeout(id); });
    }
  }

  // https://w3c.github.io/requestidlecallback/#invoke-idle-callback-timeout-algorithm
  #invokeIdleCallbackTimeout(handle: number): void {
    const request = this.#idleRequestCallbacks.get(handle) ?? this.#runnableIdleCallbacks.get(handle);
    if (request === undefined) return;
    this.cancel(handle);
    const now = unsafeSharedCurrentTime().coarsen(this.#env.crossOriginIsolatedCapability);
    const callback = request.callback;
    callback(new IdleDeadlineImpl(() => now, true, this.#env));
  }
}

/** An idle callback's live, precision-limited view of its remaining budget. */
// https://w3c.github.io/requestidlecallback/#the-idledeadline-interface
export class IdleDeadlineImpl {
  /** Whether delivery won the timeout race instead of running during idle time. */
  didTimeout: boolean;
  /** Deadline of this particular idle period, recomputed for timers/rendering. */
  #getDeadline: () => Moment;
  /** Environment selecting the same clock precision as the period's deadline. */
  #env: WindowEnvironment;

  constructor(getDeadline: () => Moment, didTimeout: boolean, env: WindowEnvironment) {
    this.#getDeadline = getDeadline;
    this.didTimeout = didTimeout;
    this.#env = env;
  }

  timeRemaining(): number {
    // SPEC_CLASH(idle-deadline-time-origin): This draft subtracts Window-relative
    // current high resolution time from HTML's shared deadline. Use two shared
    // monotonic moments, as Blink does; see scripting/ROADMAP.md for the conflict.
    const now = unsafeSharedCurrentTime().coarsen(this.#env.crossOriginIsolatedCapability);
    return Math.max(0, now.durationUntil(this.#getDeadline()).milliseconds);
  }
}

/** Post-conversion callback; Binding supplies argument projection and reporting. */
export type IdleRequestCallback = (this: void, deadline: IdleDeadlineImpl) => void;

export type IdleRequestOptions = { timeout?: number; };

/** One registration shared by the pending/runnable lists and its timeout race. */
type IdleRequest = {
  callback: IdleRequestCallback;
  timeoutAt: number | null;
  timer: TaskHandle | null;
};

/*
 * partial interface Window {
 *   unsigned long requestIdleCallback(IdleRequestCallback callback, optional IdleRequestOptions options = {});
 *   undefined cancelIdleCallback(unsigned long handle);
 * };
 */
export const windowIdleCallbackIDL = definePartialInterface({
  name: 'Window',
  members: [
    op('requestIdleCallback', idlType.unsignedLong, [
      arg('callback', reference('IdleRequestCallback'), onError('report')),
      arg('options', reference('IdleRequestOptions'), { optional: true, default: emptyDictionary }),
    ]),
    op('cancelIdleCallback', idlType.undefined, [arg('handle', idlType.unsignedLong)]),
  ],
});

// dictionary IdleRequestOptions { unsigned long timeout; };
export const idleRequestOptionsIDL = defineDictionary({
  name: 'IdleRequestOptions',
  members: [dictMember('timeout', idlType.unsignedLong)],
});

/*
 * [Exposed=Window] interface IdleDeadline {
 *   DOMHighResTimeStamp timeRemaining();
 *   readonly attribute boolean didTimeout;
 * };
 */
export const idleDeadlineIDL = defineInterface({
  name: 'IdleDeadline', exposed: 'Window', implementation: impl(IdleDeadlineImpl),
  members: [
    op('timeRemaining', reference('DOMHighResTimeStamp')),
    roAttr('didTimeout', idlType.boolean),
  ],
});

// callback IdleRequestCallback = undefined (IdleDeadline deadline);
export const idleRequestCallbackIDL = defineCallbackFunction({
  name: 'IdleRequestCallback', returns: idlType.undefined,
  arguments: [arg('deadline', reference(IdleDeadlineImpl))],
});
