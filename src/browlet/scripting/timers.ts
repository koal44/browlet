import type { DocumentImpl } from '../dom/nodes/document';
import type { Duration } from '../performance/clock';
import { createTaskSource, type EventLoop, type Task, type TaskCreationOptions } from './event-loop';

export const timerTaskSource = createTaskSource('timer');

/** Timer state owned by a WindowOrWorkerGlobalScope mixin. */
export class GlobalTimers {
  readonly #activeTimers = new Map<TimerKey, ActiveTimer>();
  readonly #eventLoop: EventLoop;
  readonly #host: TimerHost;
  readonly #idMap = new Map<number, TimerKey>();
  readonly #queueTask: GlobalTimersOptions['queueTask'];
  readonly #time: HighResolutionTimeSource;
  #fullyActive = false;
  #nextId = 1;
  #nextSequence = 0;
  #stopObservingDocument: (() => void) | null = null;

  constructor(options: GlobalTimersOptions) {
    this.#eventLoop = options.eventLoop;
    this.#host = options.host ?? nodeTimerHost;
    this.#queueTask = options.queueTask;
    this.#time = options.time;
  }

  setAssociatedDocument(document: DocumentImpl): void {
    this.#stopObservingDocument?.();
    this.#stopObservingDocument = null;
    this.#setFullyActive(false);
    this.#stopObservingDocument = document.observeFullyActiveState(
      (fullyActive) => { this.#setFullyActive(fullyActive); },
    );
    this.#setFullyActive(document.isFullyActive());
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
      cancelWakeUp: null,
      completionSteps,
      expiryTime: startTime + milliseconds,
      key: timerKey,
      milliseconds,
      orderingIdentifier,
      sequence: this.#nextSequence++,
      suspensionStartTime: this.#fullyActive ? null : startTime,
    };
    this.#activeTimers.set(timerKey, timer);
    if (this.#fullyActive) this.#schedule(timer);
    return timerKey;
  }

  setTimeout(
    action: TimerAction,
    timeout: number,
    argumentsList: readonly unknown[],
  ): number {
    return this.#initializeTimer(
      action,
      timeout,
      argumentsList,
      false,
    );
  }

  setInterval(
    action: TimerAction,
    timeout: number,
    argumentsList: readonly unknown[],
  ): number {
    return this.#initializeTimer(
      action,
      timeout,
      argumentsList,
      true,
    );
  }

  clearTimer(id: number): void {
    this.#idMap.delete(id);
  }

  #initializeTimer(
    action: TimerAction,
    timeout: number,
    argumentsList: readonly unknown[],
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
        this.#queueTask(taskSteps, { timerNestingLevel: nestingLevel });
      },
    );
    this.#idMap.set(id, uniqueHandle);
    return id;
  }

  #allocateId(): number {
    while (this.#idMap.has(this.#nextId)) this.#advanceNextId();
    const id = this.#nextId;
    this.#advanceNextId();
    return id;
  }

  #advanceNextId(): void {
    this.#nextId = this.#nextId === 2_147_483_647
      ? 1
      : this.#nextId + 1;
  }

  #setFullyActive(fullyActive: boolean): void {
    if (this.#fullyActive === fullyActive) return;

    const now = this.#currentTime();
    this.#fullyActive = fullyActive;
    if (!fullyActive) {
      for (const timer of this.#activeTimers.values()) {
        timer.cancelWakeUp?.();
        timer.cancelWakeUp = null;
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
    this.#eventLoop.notifyTaskRunnabilityChanged();
  }

  #schedule(timer: ActiveTimer): void {
    timer.cancelWakeUp?.();
    timer.cancelWakeUp = this.#host.scheduleTimeout(
      Math.max(0, timer.expiryTime - this.#currentTime()),
      () => { this.#timeoutReached(timer.key); },
    );
  }

  #timeoutReached(key: TimerKey): void {
    const timer = this.#activeTimers.get(key);
    if (timer === undefined) return;
    timer.cancelWakeUp = null;
    if (!this.#fullyActive) return;
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

  #scheduleNewlyUnblockedTimers(): void {
    const now = this.#currentTime();
    for (const timer of this.#activeTimers.values()) {
      if (
        timer.cancelWakeUp === null &&
        timer.expiryTime <= now &&
        !this.#hasOrderingBlocker(timer)
      ) this.#schedule(timer);
    }
  }

  #currentTime(): number {
    return this.#time.currentHighResolutionTime().milliseconds;
  }
}

export type TimerAction = (argumentsList: readonly unknown[]) => void;

export type TimerHost = {
  scheduleTimeout(
    this: void,
    milliseconds: number,
    steps: () => void,
  ): () => void;
};

export type GlobalTimersOptions = {
  eventLoop: EventLoop;
  queueTask: (steps: () => void, options: TaskCreationOptions) => void;
  time: HighResolutionTimeSource;
  host?: TimerHost;
};

export type TimerKey = symbol;

type HighResolutionTimeSource = {
  currentHighResolutionTime(): Duration;
};

type ActiveTimer = {
  cancelWakeUp: (() => void) | null;
  readonly completionSteps: () => void;
  expiryTime: number;
  readonly key: TimerKey;
  readonly milliseconds: number;
  readonly orderingIdentifier: string;
  readonly sequence: number;
  suspensionStartTime: number | null;
};

const nodeTimerHost: TimerHost = {
  scheduleTimeout(milliseconds, steps) {
    /* Node clamps larger delays to one millisecond; wake in bounded chunks. */
    const delay = Math.min(milliseconds, 2_147_483_647);
    const handle = setTimeout(steps, delay);
    return () => { clearTimeout(handle); };
  },
};

function isTimerTask(task: Task | null): task is Task & {
  readonly timerNestingLevel: number;
} {
  return task?.timerNestingLevel !== undefined;
}
