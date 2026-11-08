import type { TaskRecord, TaskHandle, TimerHost } from '../../infra/index';
import { Duration } from '../../timing/index';

import type { DocumentImpl } from '../dom/nodes/index';

import type { EventLoop, Task } from './event-loop';

/** Timer state owned by a WindowOrWorkerGlobalScope mixin. */
export class GlobalTimers {
  /** Waiting timeout algorithms, in registration order. */
  #activeTimers = new Map<TimerKey, ActiveTimer>();
  /** Owning task loop, used to inherit timer nesting levels. */
  #eventLoop: EventLoop;
  /** Native wake-up requests; these never invoke author code directly. */
  #host: TimerHost;
  /** Public IDs remain allocated through queued callback delivery. */
  #idMap = new Map<number, TimerKey>();
  /** Delivery onto this global's HTML timer task source. */
  #queueTask: TimerTaskQueuingSteps;
  /** This global's ordinary high-resolution clock, also used for deadline estimates. */
  #time: HighResolutionTimeSource;
  /** Worker-only clock excluding suspension, installed before the first timeout. */
  #workerClock: (() => number) | null = null;
  /** Window activity permits counting; a worker's clock itself excludes suspension. */
  #countingTime = false;
  /** Next candidate public timer ID. */
  #nextId = 1;
  /** Registration ordering independent of reusable public IDs. */
  #nextSequence = 0;
  /** Remove the associated Window Document's activity observer during cleanup. */
  #stopObservingDocument: (() => void) | null = null;

  constructor(options: GlobalTimersOptions) {
    this.#eventLoop = options.eventLoop;
    this.#host = options.host;
    this.#queueTask = options.queueTask;
    this.#time = options.time;
  }

  /** Earliest active-timer estimate, relative to this global's time origin. */
  getNextTimeoutDeadline(): Duration | null {
    let deadline = Infinity;
    for (const timer of this.#activeTimers.values()) deadline = Math.min(deadline, timer.expiryTime);
    if (deadline !== Infinity && this.#workerClock !== null) {
      // Worker deadlines use a private counted-time origin. Preserve this
      // method's ordinary time-origin-relative estimate for callers.
      deadline = this.#time.currentHighResolutionTime().milliseconds + (deadline - this.#currentTime());
    }
    return deadline === Infinity ? null : new Duration(deadline);
  }

  /** Count uncanceled public timers, including queued callbacks, and other algorithmic timeout waits. */
  hasOutstandingTimers(): boolean {
    if (this.#idMap.size > 0) return true;
    // clearTimeout/clearInterval remove the ID before the underlying wait expires.
    // Other run-steps-after-a-timeout callers have no public ID to consult.
    for (const timer of this.#activeTimers.values()) {
      if (timer.orderingIdentifier !== 'setTimeout/setInterval') return true;
    }
    return false;
  }

  /** Observe the Window's current Document, counting only its fully-active periods. */
  setAssociatedDocument(document: DocumentImpl): void {
    this.#stopObservingDocument?.();
    this.#stopObservingDocument = null;
    this.#setCountingTime(false);
    this.#stopObservingDocument = document.observeFullyActiveState(
      (fullyActive) => { this.#setCountingTime(fullyActive); },
    );
    this.#setCountingTime(document.isFullyActive());
  }

  /** Supply a monotonic worker clock excluding suspension, before creating any timeout waits. */
  setWorkerClock(readTime: () => number): void {
    this.#workerClock = readTime;
    this.#countingTime = true;
  }

  /** HTML §8.7, run steps after a timeout, using this global's timer state. */
  runStepsAfterTimeout(
    orderingIdentifier: string,
    milliseconds: number,
    completionSteps: () => void,
  ): TimerKey {
    const startTime = this.#currentTime();
    const timerKey = Symbol('Timer');
    const timer: ActiveTimer = {
      wakeUp: null,
      completionSteps,
      expiryTime: startTime + milliseconds,
      key: timerKey,
      milliseconds,
      orderingIdentifier,
      sequence: this.#nextSequence++,
      suspensionStartTime: this.#countingTime ? null : startTime,
    };
    this.#activeTimers.set(timerKey, timer);
    if (this.#countingTime) this.#schedule(timer);
    return timerKey;
  }

  /** Initialize a one-shot timer using the shared ID and nesting rules. */
  setTimeout(
    action: TimerAction,
    timeout: number,
    argumentsList: unknown[],
  ): number {
    return this.#initializeTimer(
      action,
      timeout,
      argumentsList,
      false,
    );
  }

  /** Initialize a repeating timer; each delivery starts its next wait. */
  setInterval(
    action: TimerAction,
    timeout: number,
    argumentsList: unknown[],
  ): number {
    return this.#initializeTimer(
      action,
      timeout,
      argumentsList,
      true,
    );
  }

  /** Cancel a public ID, including a callback already queued for that ID. */
  clearTimer(id: number): void {
    this.#idMap.delete(id);
  }

  /** Release timer state and host wakeups when its Document or worker finishes permanently. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#unloading-document-cleanup-steps
  clear(): void {
    for (const timer of this.#activeTimers.values()) timer.wakeUp?.remove();
    this.#activeTimers.clear();
    this.#idMap.clear();
    this.#stopObservingDocument?.();
    this.#stopObservingDocument = null;
    this.#countingTime = false;
  }

  /** Retain the ID through callback delivery and reinitialize intervals after the callback. */
  #initializeTimer(
    action: TimerAction,
    timeout: number,
    argumentsList: unknown[],
    repeat: boolean,
    previousId?: number,
  ): number {
    const id = previousId ?? this.#allocateId();
    const currentTask = this.#eventLoop.currentlyRunningTask;
    let nestingLevel = isTimerTask(currentTask)
      ? currentTask.timerNestingLevel
      : 0;

    timeout = Math.max(timeout, 0);
    if (nestingLevel > 5 && timeout < 4) timeout = 4;

    let uniqueHandle: TimerKey | null = null;
    const taskSteps = () => {
      if (
        uniqueHandle === null ||
        this.#idMap.get(id) !== uniqueHandle
      ) return;

      action(argumentsList);

      if (this.#idMap.get(id) !== uniqueHandle) return;
      if (repeat) {
        this.#initializeTimer(
          action,
          timeout,
          argumentsList,
          true,
          id,
        );
      } else {
        this.#idMap.delete(id);
      }
    };

    nestingLevel++;
    uniqueHandle = this.runStepsAfterTimeout(
      'setTimeout/setInterval',
      timeout,
      () => {
        this.#queueTask({ run: taskSteps, timerNestingLevel: nestingLevel });
      },
    );
    this.#idMap.set(id, uniqueHandle);
    return id;
  }

  /** Select an unused positive ID, wrapping without colliding with outstanding timers. */
  #allocateId(): number {
    while (this.#idMap.has(this.#nextId)) this.#advanceNextId();
    const id = this.#nextId;
    this.#advanceNextId();
    return id;
  }

  /** Advance within the public signed-long ID range. */
  #advanceNextId(): void {
    this.#nextId = this.#nextId === 2_147_483_647
      ? 1
      : this.#nextId + 1;
  }

  /** Pause Window waits and shift their deadlines by the inactive duration on resumption. */
  #setCountingTime(counting: boolean): void {
    if (this.#countingTime === counting) return;

    const now = this.#currentTime();
    this.#countingTime = counting;
    if (!counting) {
      for (const timer of this.#activeTimers.values()) {
        timer.wakeUp?.remove();
        timer.wakeUp = null;
        timer.suspensionStartTime = now;
      }
      return;
    }

    for (const timer of this.#activeTimers.values()) {
      if (timer.suspensionStartTime !== null) {
        timer.expiryTime += now - timer.suspensionStartTime;
        timer.suspensionStartTime = null;
      }
      this.#schedule(timer);
    }
  }

  /** Request the remaining delay; host wake-ups recheck the counted clock before completing. */
  #schedule(timer: ActiveTimer): void {
    timer.wakeUp?.remove();
    timer.wakeUp = this.#host.scheduleTimeout(
      Math.max(0, timer.expiryTime - this.#currentTime()),
      () => { this.#timeoutReached(timer.key); },
    );
  }

  /** Recheck elapsed time after host delay limits or worker suspension, then enforce ordering. */
  #timeoutReached(key: TimerKey): void {
    const timer = this.#activeTimers.get(key);
    if (timer === undefined) return;
    timer.wakeUp = null;
    if (!this.#countingTime) return;
    if (this.#currentTime() < timer.expiryTime) {
      this.#schedule(timer);
      return;
    }
    if (this.#hasOrderingBlocker(timer)) return;

    try {
      timer.completionSteps();
    } finally {
      this.#activeTimers.delete(key);
      this.#scheduleNewlyUnblockedTimers();
    }
  }

  /** Find an earlier invocation with the same ordering identifier and no greater delay. */
  #hasOrderingBlocker(timer: ActiveTimer): boolean {
    for (const candidate of this.#activeTimers.values()) {
      if (candidate.sequence >= timer.sequence) break;
      if (
        candidate.orderingIdentifier === timer.orderingIdentifier &&
        candidate.milliseconds <= timer.milliseconds
      ) return true;
    }
    return false;
  }

  /** Revisit elapsed waits whose earlier ordered invocation has just completed. */
  #scheduleNewlyUnblockedTimers(): void {
    const now = this.#currentTime();
    for (const timer of this.#activeTimers.values()) {
      if (
        timer.wakeUp === null &&
        timer.expiryTime <= now &&
        !this.#hasOrderingBlocker(timer)
      ) this.#schedule(timer);
    }
  }

  /** Read counted worker time or the Window clock whose inactive periods shift deadlines. */
  #currentTime(): number {
    return this.#workerClock?.() ?? this.#time.currentHighResolutionTime().milliseconds;
  }
}

export type TimerAction = (argumentsList: unknown[]) => void;

export type GlobalTimersOptions = {
  eventLoop: EventLoop;
  queueTask: TimerTaskQueuingSteps;
  time: HighResolutionTimeSource;
  host: TimerHost;
};

export type TimerKey = symbol;

/** Queue a timer task in its owning global with the supplied task metadata. */
type TimerTaskQueuingSteps = (task: TaskRecord) => void;

type HighResolutionTimeSource = {
  currentHighResolutionTime(): Duration;
};

/** One timeout wait; expiry uses the counted clock, not necessarily performance.now()'s origin. */
type ActiveTimer = {
  wakeUp: TaskHandle | null;
  completionSteps: () => void;
  expiryTime: number;
  key: TimerKey;
  milliseconds: number;
  orderingIdentifier: string;
  sequence: number;
  suspensionStartTime: number | null;
};

function isTimerTask(task: Task | null): task is Task & {
  timerNestingLevel: number;
} {
  return task?.timerNestingLevel !== undefined;
}
