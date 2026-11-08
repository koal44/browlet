import { describe, expect, it, vi } from 'vitest';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { createTestDocument } from '../../support/dom';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { Duration } from
  '../../../src/timing/clock';
import type { EventLoop } from '../../../src/browlet/scripting/event-loop';
import { GlobalTimers } from '../../../src/browlet/scripting/timers';
import { timerTaskSource } from '../../../src/browlet/scripting/tasks';
import type { TaskHandle, TimerHost } from '../../../src/infra/tasks';

describe('HTML timers', () => {
  it('counts a timeout through queued callback delivery, then releases it', () => {
    const { timers, host, eventLoop } = createTimerFixture();
    const callback = vi.fn();
    expect(timers.hasOutstandingTimers()).toBe(false);
    timers.setTimeout(callback, 10, []);
    expect(timers.hasOutstandingTimers()).toBe(true);
    host.advanceBy(10);
    expect(callback).not.toHaveBeenCalled();
    expect(timers.hasOutstandingTimers()).toBe(true);
    runNextTask(eventLoop);
    expect(callback).toHaveBeenCalledOnce();
    expect(timers.hasOutstandingTimers()).toBe(false);
  });

  it.each([false, true])('does not count a cleared timer when its callback was queued: %s', (queued) => {
    const { timers, host, eventLoop } = createTimerFixture();
    const callback = vi.fn();
    const id = timers.setTimeout(callback, 10, []);
    if (queued) host.advanceBy(10);
    timers.clearTimer(id);
    expect(timers.hasOutstandingTimers()).toBe(false);
    if (!queued) host.advanceBy(10);
    runNextTask(eventLoop);
    expect(callback).not.toHaveBeenCalled();
    expect(timers.hasOutstandingTimers()).toBe(false);
  });

  it('keeps an interval outstanding between deliveries until it is canceled', () => {
    const { timers, host, eventLoop } = createTimerFixture();
    const id = timers.setInterval(() => {}, 10, []);
    host.advanceBy(10);
    runNextTask(eventLoop);
    expect(timers.hasOutstandingTimers()).toBe(true);
    timers.clearTimer(id);
    expect(timers.hasOutstandingTimers()).toBe(false);
  });

  it('counts algorithmic waits without public IDs and releases them on completion or cleanup', () => {
    const { timers, host } = createTimerFixture();
    timers.runStepsAfterTimeout('AbortSignal-timeout', 10, () => {});
    expect(timers.hasOutstandingTimers()).toBe(true);
    host.advanceBy(10);
    expect(timers.hasOutstandingTimers()).toBe(false);
    timers.runStepsAfterTimeout('JavaScript', 10, () => {});
    timers.clear();
    expect(timers.hasOutstandingTimers()).toBe(false);
  });

  it('counts only fully-active time before completing a timeout', () => {
    const fixture = createTimerFixture();
    const completion = vi.fn();
    const activeEntry = fixture.traversable.activeSessionHistoryEntry;

    fixture.timers.runStepsAfterTimeout('example', 10, completion);
    expect(fixture.timers.getNextTimeoutDeadline()?.milliseconds).toBe(10);
    fixture.host.advanceBy(4);

    const inactiveDocument = createTestDocument();
    inactiveDocument.browsingContext = fixture.traversable.activeBrowsingContext;
    fixture.traversable.activeSessionHistoryEntry =
      inactiveDocument.env.createSessionHistoryEntry(inactiveDocument.url, DocumentState.create(inactiveDocument));
    fixture.host.advanceBy(100);

    expect(completion).not.toHaveBeenCalled();

    fixture.traversable.activeSessionHistoryEntry = activeEntry;
    expect(fixture.timers.getNextTimeoutDeadline()?.milliseconds).toBe(110);
    fixture.host.advanceBy(5);
    expect(completion).not.toHaveBeenCalled();

    fixture.host.advanceBy(1);
    expect(completion).toHaveBeenCalledOnce();
    expect(fixture.timers.getNextTimeoutDeadline()).toBeNull();
  });

  it('preserves the required ordering among equal-delay timers', () => {
    const fixture = createTimerFixture();
    const order: string[] = [];

    fixture.timers.runStepsAfterTimeout(
      'ordered',
      10,
      () => { order.push('first'); },
    );
    fixture.timers.runStepsAfterTimeout(
      'ordered',
      10,
      () => { order.push('second'); },
    );

    fixture.host.advanceBy(10, true);

    expect(order).toEqual(['first', 'second']);
  });

  it('shares IDs across one-shot and repeating timers and clears either', () => {
    const fixture = createTimerFixture();
    const oneShot = vi.fn();
    const interval = vi.fn();
    const timeoutId = fixture.timers.setTimeout(oneShot, 0, ['argument']);
    const intervalId = fixture.timers.setInterval(interval, 5, []);

    expect([timeoutId, intervalId]).toEqual([1, 2]);
    fixture.timers.clearTimer(timeoutId);
    fixture.host.advanceBy(0);
    runNextTask(fixture.eventLoop);
    expect(oneShot).not.toHaveBeenCalled();

    fixture.host.advanceBy(5);
    runNextTask(fixture.eventLoop);
    expect(interval).toHaveBeenCalledOnce();

    fixture.timers.clearTimer(intervalId);
    fixture.host.advanceBy(5);
    runNextTask(fixture.eventLoop);
    expect(interval).toHaveBeenCalledOnce();
  });

  it('clears delayed completions and already queued timer callbacks during destruction', () => {
    const fixture = createTimerFixture();
    const timeout = vi.fn();
    const interval = vi.fn();
    const delayed = vi.fn();
    fixture.timers.setTimeout(timeout, 0, []);
    fixture.timers.setInterval(interval, 0, []);
    fixture.timers.runStepsAfterTimeout('completion', 10, delayed);
    fixture.host.advanceBy(0);

    fixture.timers.clear();
    while (fixture.eventLoop.hasRunnableTasks()) runNextTask(fixture.eventLoop);
    fixture.host.advanceBy(100);

    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(delayed).not.toHaveBeenCalled();
  });

  it('clamps timers nested beyond level five to four milliseconds', () => {
    const fixture = createTimerFixture();
    let calls = 0;
    const action = () => {
      calls++;
      if (calls < 7) fixture.timers.setTimeout(action, 0, []);
    };

    fixture.timers.setTimeout(action, 0, []);
    for (let index = 0; index < 6; index++) {
      fixture.host.runNextWakeUp();
      runNextTask(fixture.eventLoop);
    }

    expect(calls).toBe(6);
    expect(fixture.host.requestedDelays.at(-1)).toBe(4);
  });
});

describe('worker timeout accounting', () => {
  it('counts disjoint running periods and rechecks overdue native wake-ups', () => {
    const { timers, host, pause } = createWorkerTimerFixture();
    const completion = vi.fn();
    timers.runStepsAfterTimeout('example', 10, completion);
    host.advanceBy(4);
    pause(100);
    host.advanceBy(0);
    expect(completion).not.toHaveBeenCalled();
    expect(timers.getNextTimeoutDeadline()?.milliseconds).toBe(110);
    host.advanceBy(3);
    pause(50);
    host.advanceBy(2);
    expect(completion).not.toHaveBeenCalled();
    expect(timers.getNextTimeoutDeadline()?.milliseconds).toBe(160);
    host.advanceBy(1);
    expect(completion).toHaveBeenCalledOnce();
  });

  it('preserves ordering when several native wake-ups expire during suspension', () => {
    const { timers, host, pause } = createWorkerTimerFixture();
    const calls: string[] = [];
    timers.runStepsAfterTimeout('ordered', 10, () => { calls.push('first'); });
    timers.runStepsAfterTimeout('ordered', 10, () => { calls.push('second'); });
    host.advanceBy(4);
    pause(100);
    host.advanceBy(0, true);
    expect(calls).toEqual([]);
    host.advanceBy(6, true);
    expect(calls).toEqual(['first', 'second']);
  });

  it('retains already queued callbacks and starts the next interval wait after delivery', () => {
    const { timers, eventLoop, host, pause } = createWorkerTimerFixture();
    const callback = vi.fn();
    const id = timers.setInterval(callback, 10, []);
    host.advanceBy(10);
    pause(100);
    runNextTask(eventLoop);
    expect(callback).toHaveBeenCalledOnce();
    host.advanceBy(9);
    expect(eventLoop.hasRunnableTasks()).toBe(false);
    host.advanceBy(1);
    runNextTask(eventLoop);
    expect(callback).toHaveBeenCalledTimes(2);
    timers.clearTimer(id);
    timers.clear();
  });

  it('does not revive queued or waiting callbacks after permanent cleanup', () => {
    const { timers, eventLoop, host, pause } = createWorkerTimerFixture();
    const callback = vi.fn();
    timers.setTimeout(callback, 0, []);
    timers.runStepsAfterTimeout('completion', 10, callback);
    host.advanceBy(0);
    pause(100);
    timers.clear();
    while (eventLoop.hasRunnableTasks()) runNextTask(eventLoop);
    host.advanceBy(100);
    expect(callback).not.toHaveBeenCalled();
    expect(timers.hasOutstandingTimers()).toBe(false);
  });
});

/** Independent host and counted clocks model a blocked native wait without real-time tolerances. */
function createWorkerTimerFixture() {
  const host = new ManualTimerHost();
  const eventLoop = createManualEventLoop();
  let suspended = 0;
  const timers = new GlobalTimers({
    eventLoop, host,
    time: { currentHighResolutionTime: () => new Duration(host.now) },
    queueTask: (task) => { eventLoop.queueTask(timerTaskSource, null, task); },
  });
  // A distinct origin also verifies that public deadline estimates stay relative
  // to the global's ordinary clock, not this private counted-time origin.
  timers.setWorkerClock(() => 1000 + host.now - suspended);
  return {
    timers, host, eventLoop,
    pause(this: void, milliseconds: number) { suspended += milliseconds; host.now += milliseconds; },
  };
}

function createTimerFixture() {
  const host = new ManualTimerHost();
  const userAgent = createManualUserAgent();
  userAgent.timerHost = host;
  const traversable = TopLevelTraversable.create(
    userAgent,
    null,
    '',
  );
  const document = traversable.activeDocument;
  if (document === null) throw new Error('Expected an active Document');

  const { env } = document;
  const eventLoop = env.responsibleEventLoop;
  vi.spyOn(env, 'currentHighResolutionTime').mockImplementation(() => new Duration(host.now));
  const timers = env.getWindowOrWorkerGlobalScopeMixin().timers;
  return { eventLoop, host, timers, traversable };
}

function runNextTask(eventLoop: EventLoop): void {
  expect(eventLoop.runTaskTurn()).toBe(true);
}

class ManualTimerHost implements TimerHost {
  now = 0;
  requestedDelays: number[] = [];
  #nextSequence = 0;
  #wakeUps = new Set<ManualWakeUp>();

  scheduleTimeout(milliseconds: number, steps: () => void): TaskHandle {
    this.requestedDelays.push(milliseconds);
    const wakeUp = {
      at: this.now + milliseconds,
      canceled: false,
      sequence: this.#nextSequence++,
      steps,
    };
    this.#wakeUps.add(wakeUp);
    return { remove: () => { wakeUp.canceled = true; } };
  }

  advanceBy(milliseconds: number, newestFirst = false): void {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.#wakeUps]
        .filter((wakeUp) => !wakeUp.canceled && wakeUp.at <= target)
        .sort((a, b) => a.at - b.at || (newestFirst
          ? b.sequence - a.sequence
          : a.sequence - b.sequence));
      const wakeUp = due.at(0);
      if (wakeUp === undefined) break;

      this.#wakeUps.delete(wakeUp);
      this.now = Math.max(this.now, wakeUp.at);
      wakeUp.steps();
    }
    this.now = target;
  }

  runNextWakeUp(): void {
    const wakeUp = [...this.#wakeUps]
      .filter((candidate) => !candidate.canceled)
      .sort((a, b) => a.at - b.at || a.sequence - b.sequence).at(0);
    if (wakeUp === undefined) throw new Error('Expected a timer wake-up');
    this.advanceBy(wakeUp.at - this.now);
  }
}

type ManualWakeUp = {
  at: number;
  canceled: boolean;
  sequence: number;
  steps: () => void;
};
