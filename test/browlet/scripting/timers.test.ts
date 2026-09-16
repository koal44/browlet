import { describe, expect, it, vi } from 'vitest';
import { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import {
  createDocumentState, createSessionHistoryEntry,
} from '../../../src/browlet/browsing/navigation/session-history';
import {
  createNewTopLevelTraversable,
} from '../../../src/browlet/browsing/navigable';
import { UserAgent } from '../../../src/browlet/user-agent';
import { Duration, monotonicClock, UnsafeMoment } from
  '../../../src/browlet/performance/clock';
import {
  EventLoop, type EventLoopOptions,
} from '../../../src/browlet/scripting/event-loop';
import {
  GlobalTimers, timerTaskSource, type TimerHost,
} from '../../../src/browlet/scripting/timers';

describe('HTML timers', () => {
  it('counts only fully-active time before completing a timeout', () => {
    const fixture = createTimerFixture();
    const completion = vi.fn();
    const activeEntry = fixture.traversable.activeSessionHistoryEntry;

    fixture.timers.runStepsAfterTimeout('example', 10, completion);
    fixture.host.advanceBy(4);

    const inactiveDocument = new DocumentImpl();
    inactiveDocument.setBrowsingContext(fixture.traversable.activeBrowsingContext);
    fixture.traversable.activeSessionHistoryEntry =
      createSessionHistoryEntry(createDocumentState(inactiveDocument));
    fixture.host.advanceBy(100);

    expect(completion).not.toHaveBeenCalled();

    fixture.traversable.activeSessionHistoryEntry = activeEntry;
    fixture.host.advanceBy(5);
    expect(completion).not.toHaveBeenCalled();

    fixture.host.advanceBy(1);
    expect(completion).toHaveBeenCalledOnce();
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

function createTimerFixture() {
  const traversable = createNewTopLevelTraversable(
    new UserAgent(),
    null,
    '',
  );
  const document = traversable.activeDocument;
  if (document === null) throw new Error('Expected an active Document');

  const eventLoop = new EventLoop(createEventLoopOptions()
    .createMicrotaskQueue());
  const host = new ManualTimerHost();
  const timers = new GlobalTimers({
    eventLoop,
    queueTask: (steps, options) => { eventLoop.queueTask(timerTaskSource, document, steps, options); },
    host,
    time: {
      currentHighResolutionTime: () => new Duration(host.now),
    },
  });
  timers.setAssociatedDocument(document);
  return { eventLoop, host, timers, traversable };
}

function runNextTask(eventLoop: EventLoop): void {
  expect(eventLoop.runTaskTurn(createEventLoopOptions())).toBe(true);
}

function createEventLoopOptions(): EventLoopOptions {
  return {
    createMicrotaskQueue: () => ({
      kind: 'ambient',
      enqueueMicrotask: (steps) => { queueMicrotask(steps); },
      performMicrotaskCheckpoint: vi.fn(),
    }),
    requestEventLoopTurn: vi.fn(),
    unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 0),
  };
}

class ManualTimerHost implements TimerHost {
  now = 0;
  readonly requestedDelays: number[] = [];
  #nextSequence = 0;
  readonly #wakeUps = new Set<ManualWakeUp>();

  scheduleTimeout(milliseconds: number, steps: () => void): () => void {
    this.requestedDelays.push(milliseconds);
    const wakeUp = {
      at: this.now + milliseconds,
      canceled: false,
      sequence: this.#nextSequence++,
      steps,
    };
    this.#wakeUps.add(wakeUp);
    return () => { wakeUp.canceled = true; };
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
      this.now = wakeUp.at;
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
  readonly at: number;
  canceled: boolean;
  readonly sequence: number;
  readonly steps: () => void;
};
