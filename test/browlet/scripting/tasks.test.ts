import { AsyncLocalStorage } from 'node:async_hooks';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserAgent } from '../../../src/browlet/user-agent';
import { createTestDocument } from '../../support/dom';

import { Browlet } from '../../../src/browlet/browlet';
import {
  type JSMicrotaskQueue,
} from '../../../src/js-engine/index';
import {
  EventLoop, createTaskSource, type EventLoopInit,
  type LongTaskReporter, Task, type TaskQueueSelector, type TaskTimingHooks,
} from '../../../src/browlet/scripting/event-loop';
import {
  domManipulationTaskSource, navigationAndTraversalTaskSource, networkingTaskSource,
  renderingTaskSource, userInteractionTaskSource,
} from '../../../src/browlet/scripting/tasks';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { getRelevantRealm } from '../../support/browlet-binding';
import {
  monotonicClock, UnsafeMoment,
} from '../../../src/browlet/timing/clock';

import * as timing from '../../../src/browlet/timing/high-resolution-time';

afterEach(() => { vi.restoreAllMocks(); });

describe('task queues', () => {
  it('defines distinct shared identities for the generic task sources', () => {
    const sources = [
      domManipulationTaskSource,
      userInteractionTaskSource,
      networkingTaskSource,
      navigationAndTraversalTaskSource,
      renderingTaskSource,
    ];

    expect(sources.map((source) => source.name)).toEqual([
      'DOM manipulation',
      'user interaction',
      'networking',
      'navigation and traversal',
      'rendering',
    ]);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('appends tasks from one source in insertion order', () => {
    const eventLoop = createEventLoop();
    const source = createTaskSource('test');
    const first = vi.fn();
    const second = vi.fn();

    eventLoop.queueTask(source, null, first);
    eventLoop.queueTask(source, null, second);

    const tasks = [...eventLoop.getTaskQueue(source)];
    expect(tasks.every((task) => task instanceof Task)).toBe(true);
    expect(tasks.map((task) => task.steps)).toEqual([first, second]);
    expect(tasks.map((task) => task.source)).toEqual([source, source]);
    expect(tasks.map((task) => task.document)).toEqual([null, null]);
    expect(tasks.every((task) =>
      task.scriptEvaluationEnvironments.size === 0,
    )).toBe(true);
  });

  it('removes only the queued global task identified by a handle', () => {
    const traversable = TopLevelTraversable.create(
      new UserAgent(),
      null,
      '',
    );
    const window = traversable.activeWindow;
    if (window === null) throw new Error('Expected an active Window');
    const realm = getRelevantRealm(window);
    const first = vi.fn();
    const second = vi.fn();
    const source = createTaskSource('removable');
    const firstTask = realm.queueGlobalTask(source, first);

    realm.queueGlobalTask(source, second);

    expect(firstTask.remove()).toBe(true);
    expect(firstTask.remove()).toBe(false);
    expect(requireEventLoop(window).runTaskTurn()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('removes a destroyed document\'s tasks across sources while preserving other documents and host tasks', () => {
    const eventLoop = createEventLoop();
    const document = createTestDocument();
    const otherDocument = createTestDocument();
    const canceled = vi.fn();
    eventLoop.queueTask(networkingTaskSource, document, canceled);
    eventLoop.queueTask(domManipulationTaskSource, document, canceled);
    const other = eventLoop.queueTask(networkingTaskSource, otherDocument, vi.fn());
    const host = eventLoop.queueTask(domManipulationTaskSource, null, vi.fn());

    eventLoop.removeTasksForDocument(document);

    expect([...eventLoop.getTaskQueue(networkingTaskSource)]).toEqual([other]);
    expect([...eventLoop.getTaskQueue(domManipulationTaskSource)]).toEqual([host]);
    expect(canceled).not.toHaveBeenCalled();
  });

  it('associates sources independently on each event loop', () => {
    const firstLoop = createEventLoop();
    const secondLoop = createEventLoop();
    const firstSource = createTaskSource('same diagnostic name');
    const secondSource = createTaskSource('same diagnostic name');

    firstLoop.queueTask(firstSource, null, vi.fn());
    firstLoop.queueTask(secondSource, null, vi.fn());
    secondLoop.queueTask(firstSource, null, vi.fn());

    expect(firstLoop.getTaskQueues().size).toBe(2);
    expect(secondLoop.getTaskQueues().size).toBe(1);
    expect(firstLoop.getTaskQueue(firstSource)).not.toBe(
      secondLoop.getTaskQueue(firstSource),
    );
  });

  it('retains task registration context without moving Node reactions into HTML', async () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    const unrelated = new AsyncLocalStorage<string>();
    const observed: (string | undefined)[] = [];
    unrelated.run('registration', () => {
      realm.queueGlobalTask(networkingTaskSource, () => {
        observed.push(unrelated.getStore());
        void Promise.resolve().then(() => { observed.push(unrelated.getStore()); });
      });
    });
    unrelated.run('draining turn', () => {
      expect(realm.agent.eventLoop.runTaskTurn()).toBe(true);
      expect(unrelated.getStore()).toBe('draining turn');
    });
    expect(observed).toEqual(['registration']);
    await setImmediate();
    expect(observed).toEqual(['registration', 'registration']);
  });

  it('runs the oldest runnable task and then reaches its checkpoint', () => {
    const microtaskQueue = createMicrotaskQueue({
      performMicrotaskCheckpoint() {
        expect(eventLoop.currentlyRunningTask).toBeNull();
        order.push('checkpoint');
      },
    });
    const eventLoop = createEventLoop({}, microtaskQueue);
    const source = createTaskSource('turn');
    const inactiveDocument = createTestDocument();
    const inactiveSteps = vi.fn();
    const order: string[] = [];
    const runnableSteps = vi.fn(() => {
      expect(eventLoop.currentlyRunningTask?.steps).toBe(runnableSteps);
      order.push('task');
    });

    eventLoop.queueTask(source, inactiveDocument, inactiveSteps);
    eventLoop.queueTask(source, null, runnableSteps);

    expect(eventLoop.runTaskTurn()).toBe(true);
    expect(order).toEqual(['task', 'checkpoint']);
    expect(inactiveSteps).not.toHaveBeenCalled();
    expect([...eventLoop.getTaskQueue(source)].map((task) => task.steps)).toEqual([inactiveSteps]);
  });

  it('uses its scheduling policy to choose among runnable task queues', () => {
    const selectTaskQueue = vi.fn<TaskQueueSelector>((queues) => queues[1]!);
    const eventLoop = createEventLoop({ selectTaskQueue });
    const firstSource = createTaskSource('first');
    const secondSource = createTaskSource('second');
    const first = vi.fn();
    const second = vi.fn();
    const firstQueue = eventLoop.getTaskQueue(firstSource);
    const secondQueue = eventLoop.getTaskQueue(secondSource);

    eventLoop.queueTask(firstSource, null, first);
    eventLoop.queueTask(secondSource, null, second);
    eventLoop.runTaskTurn();

    expect(selectTaskQueue).toHaveBeenCalledWith([firstQueue, secondQueue]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('leaves unrunnable tasks queued without checkpointing', () => {
    const checkpoint = vi.fn();
    const eventLoop = createEventLoop({}, createMicrotaskQueue({ performMicrotaskCheckpoint: checkpoint }));
    const source = createTaskSource('inactive');
    const steps = vi.fn();
    eventLoop.queueTask(source, createTestDocument(), steps);

    expect(eventLoop.runTaskTurn()).toBe(false);
    expect(steps).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
    expect(eventLoop.getTaskQueue(source).size).toBe(1);
  });

  it('clears the current task and checkpoints when task steps throw', () => {
    const checkpoint = vi.fn();
    const longTaskReporter = createLongTaskReporter();
    const eventLoop = createEventLoop({ longTaskReporter }, createMicrotaskQueue({ performMicrotaskCheckpoint: checkpoint }));
    const source = createTaskSource('throwing');
    const error = new Error('task failed');
    eventLoop.queueTask(source, null, () => { throw error; });

    expect(() => eventLoop.runTaskTurn()).toThrow(error);
    expect(eventLoop.currentlyRunningTask).toBeNull();
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(longTaskReporter.reportLongTasks).toHaveBeenCalledOnce();
  });

  it('accounts for a task around its steps and checkpoint', () => {
    const order: string[] = [];
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    const document = traversable.activeDocument!;
    const startTime = new UnsafeMoment(monotonicClock, 10);
    const endTime = new UnsafeMoment(monotonicClock, 20);
    const clock = vi.spyOn(timing, 'unsafeSharedCurrentTime')
      .mockReturnValueOnce(startTime).mockReturnValueOnce(endTime);
    const taskTiming: TaskTimingHooks = {
      recordTaskStartTime(time, taskDocument) {
        expect(time).toBe(startTime);
        expect(taskDocument).toBe(document);
        order.push('start');
      },
      recordTaskEndTime(time, taskDocument) {
        expect(time).toBe(endTime);
        expect(taskDocument).toBe(document);
        order.push('end');
      },
    };
    const longTaskReporter: LongTaskReporter = {
      reportLongTasks(firstTime, secondTime, accountedTask) {
        expect(firstTime).toBe(startTime);
        expect(secondTime).toBe(endTime);
        expect(accountedTask).toBe(task);
        order.push('long task');
      },
    };
    const eventLoop = createEventLoop({ longTaskReporter, taskTiming }, createMicrotaskQueue({
      performMicrotaskCheckpoint() { order.push('checkpoint'); },
    }));
    const task = eventLoop.queueTask(createTaskSource('accounting'), document, () => { order.push('task'); });

    eventLoop.runTaskTurn();

    expect(order).toEqual(['start', 'task', 'checkpoint', 'long task', 'end']);
    expect(clock).toHaveBeenCalledTimes(2);
  });

  it('omits Document timing hooks for a null-Document task', () => {
    const longTaskReporter = createLongTaskReporter();
    const taskTiming = createTaskTimingHooks();
    const eventLoop = createEventLoop({ longTaskReporter, taskTiming });
    eventLoop.queueTask(createTaskSource('null Document'), null, vi.fn());
    eventLoop.runTaskTurn();

    expect(taskTiming.recordTaskStartTime).not.toHaveBeenCalled();
    expect(longTaskReporter.reportLongTasks).toHaveBeenCalledOnce();
    expect(taskTiming.recordTaskEndTime).not.toHaveBeenCalled();
  });

  it('coalesces host wake-ups and requests one later turn per task', () => {
    const order: string[] = [];
    const turns: (() => void)[] = [];
    const eventLoop = createEventLoop({ requestTurn(steps) { turns.push(steps); } }, createMicrotaskQueue({
      performMicrotaskCheckpoint() { order.push('checkpoint'); },
    }));
    const source = createTaskSource('scheduled');
    expect(turns).toEqual([]);

    eventLoop.queueTask(source, null, () => { order.push('first'); });
    eventLoop.queueTask(source, null, () => { order.push('second'); });

    expect(turns).toHaveLength(1);
    turns.shift()?.();
    expect(order).toEqual(['first', 'checkpoint']);
    expect(turns).toHaveLength(1);
    turns.shift()?.();
    expect(order).toEqual(['first', 'checkpoint', 'second', 'checkpoint']);
    expect(turns).toEqual([]);
  });

  it('requests a host turn when runnable work arrives after construction', () => {
    const turns: (() => void)[] = [];
    const eventLoop = createEventLoop({ requestTurn(steps) { turns.push(steps); } });
    const source = createTaskSource('late');
    expect(turns).toEqual([]);

    eventLoop.queueTask(source, null, vi.fn());
    eventLoop.queueTask(source, null, vi.fn());
    expect(turns).toHaveLength(1);
  });

  it('does not request a host turn for inactive Document work', () => {
    const requestTurn = vi.fn();
    const eventLoop = createEventLoop({ requestTurn });
    eventLoop.queueTask(createTaskSource('inactive scheduled'), createTestDocument(), vi.fn());
    expect(requestTurn).not.toHaveBeenCalled();
  });

  it('does not enter another task turn while one is running', () => {
    const eventLoop = createEventLoop();
    const source = createTaskSource('reentrant');
    const second = vi.fn();
    eventLoop.queueTask(source, null, () => {
      expect(() => eventLoop.runTaskTurn()).toThrow('An event loop cannot run a task reentrantly');
    });
    eventLoop.queueTask(source, null, second);
    eventLoop.runTaskTurn();

    expect(second).not.toHaveBeenCalled();
    expect(eventLoop.getTaskQueue(source).size).toBe(1);
  });

  it('derives a Window task destination and Document from its Realm', () => {
    const traversable = TopLevelTraversable.create(
      new UserAgent(),
      null,
      '',
    );
    const window = traversable.activeWindow;
    const document = traversable.activeDocument;
    if (window === null || document === null) {
      throw new Error('Expected a complete top-level traversable');
    }
    const source = createTaskSource('global');

    getRelevantRealm(window).queueGlobalTask(source, vi.fn());

    const [task] = requireEventLoop(window).getTaskQueue(source);
    expect(task!.document).toBe(document);
  });

  it('captures the surrounding Window Realm Document for a microtask', () => {
    const traversable = TopLevelTraversable.create(
      new UserAgent(),
      null,
      '',
    );
    const window = traversable.activeWindow;
    const document = traversable.activeDocument;
    if (window === null || document === null) {
      throw new Error('Expected a complete top-level traversable');
    }
    const realm = getRelevantRealm(window);
    const steps = vi.fn();
    const queueMicrotask = vi.spyOn(realm.agent.eventLoop, 'queueMicrotask')
      .mockImplementation(() => {});

    realm.queueMicrotask(steps);

    expect(queueMicrotask).toHaveBeenCalledWith(steps, document);
  });

  it('captures each task Document when queued, even if the Window changes Documents', () => {
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    const window = traversable.activeWindow!;
    const realm = getRelevantRealm(window);
    const firstDocument = window.getAssociatedDocument();
    const replacement = createTestDocument(realm.env);
    const source = createTaskSource('document replacement');

    realm.queueGlobalTask(source, vi.fn());
    window.setAssociatedDocument(replacement);
    realm.queueGlobalTask(source, vi.fn());

    expect([...requireEventLoop(window).getTaskQueue(source)].map((task) => task.document))
      .toEqual([firstDocument, replacement]);
  });

  it('identifies a microtask as the currently running task', () => {
    let queuedSteps: (() => void) | undefined;
    const microtaskQueue = createMicrotaskQueue({
      enqueueMicrotask(steps) { queuedSteps = steps; },
    });
    const eventLoop = createEventLoop({}, microtaskQueue);
    const steps = vi.fn(() => {
      expect(eventLoop.currentlyRunningTask?.steps).toBe(steps);
    });

    eventLoop.queueMicrotask(steps);
    queuedSteps?.();

    expect(steps).toHaveBeenCalledOnce();
    expect(eventLoop.currentlyRunningTask).toBeNull();
  });

  it('suppresses reentrant microtask checkpoints', () => {
    const checkpoint = vi.fn();
    const microtaskQueue = createMicrotaskQueue({
      performMicrotaskCheckpoint: checkpoint,
    });
    const eventLoop = createEventLoop({}, microtaskQueue);
    checkpoint.mockImplementation(() => {
      eventLoop.performMicrotaskCheckpoint();
    });

    eventLoop.performMicrotaskCheckpoint();

    expect(checkpoint).toHaveBeenCalledOnce();
  });

  it('identifies host-queued microtask execution as a checkpoint', () => {
    let queuedSteps: (() => void) | undefined;
    const checkpoint = vi.fn();
    const microtaskQueue = createMicrotaskQueue({
      enqueueMicrotask(steps) { queuedSteps = steps; },
      performMicrotaskCheckpoint: checkpoint,
    });
    const eventLoop = createEventLoop({}, microtaskQueue);

    eventLoop.queueMicrotask(() => {
      eventLoop.performMicrotaskCheckpoint();
    });
    queuedSteps?.();

    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('clears the current task after a nested microtask without permitting another task turn', () => {
    let queuedSteps: (() => void) | undefined;
    const eventLoop = createEventLoop({}, createMicrotaskQueue({
      enqueueMicrotask(steps) { queuedSteps = steps; },
    }));
    const source = createTaskSource('outer');
    const microtask = vi.fn();
    const outer = vi.fn(() => {
      eventLoop.queueMicrotask(microtask);
      queuedSteps?.();
      expect(eventLoop.currentlyRunningTask).toBeNull();
      expect(() => eventLoop.runTaskTurn()).toThrow(
        'An event loop cannot run a task reentrantly',
      );
    });

    eventLoop.queueTask(source, null, outer);
    eventLoop.runTaskTurn();

    expect(microtask).toHaveBeenCalledOnce();
    expect(eventLoop.currentlyRunningTask).toBeNull();
  });

  it(
    'does not report an adopted Stream start rejection as unhandled',
    async () => {
      /*
       * Parsing enters through an HTML task. Entering from a Node Promise job
       * previously let a nested checkpoint report this rejection before the
       * stream's adoption ran.
       */
      const unhandled = vi.fn();
      const handled = vi.fn();
      process.on('unhandledRejection', unhandled);
      process.on('rejectionHandled', handled);
      try {
        const browlet = new Browlet({
          route: () => `<script>
            new ReadableStream({
              start() {
                return Promise.reject({ name: 'boo!' });
              }
            });
          </script>`,
        });
        await browlet.navigate('http://example.test/');
        await setImmediate();

        expect(unhandled).not.toHaveBeenCalled();
        expect(handled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
        process.off('rejectionHandled', handled);
      }
    },
  );

  it('makes only null-Document or fully-active tasks runnable', () => {
    const traversable = TopLevelTraversable.create(
      new UserAgent(),
      null,
      '',
    );
    const activeDocument = traversable.activeDocument;
    const browsingContext = traversable.activeBrowsingContext;
    if (activeDocument === null || browsingContext === null) {
      throw new Error('Expected a complete top-level traversable');
    }
    const inactiveDocument = createTestDocument(activeDocument.env);
    inactiveDocument.browsingContext = browsingContext;

    expect(createTask(null).isRunnable).toBe(true);
    expect(createTask(activeDocument).isRunnable).toBe(true);
    expect(createTask(inactiveDocument).isRunnable).toBe(false);
  });
});

function requireEventLoop(global: object): EventLoop {
  return getRelevantRealm(global).agent.eventLoop;
}

function createTask(document: DocumentImpl | null): Task {
  return new Task(createTaskSource('runnable'), document, () => {});
}

function createEventLoop(init: Partial<EventLoopInit> = {}, microtaskQueue = createMicrotaskQueue()): EventLoop {
  const loop = new EventLoop({ requestTurn: () => {}, ...init });
  loop.microtaskQueue = microtaskQueue;
  return loop;
}

function createMicrotaskQueue(
  overrides: Partial<JSMicrotaskQueue> = {},
): JSMicrotaskQueue {
  return {
    kind: overrides.kind ?? 'explicit',
    enqueueMicrotask: vi.fn(overrides.enqueueMicrotask ?? (() => {})),
    performMicrotaskCheckpoint: vi.fn(
      overrides.performMicrotaskCheckpoint ?? (() => {}),
    ),
  };
}

function createTaskTimingHooks(): TaskTimingHooks {
  return {
    recordTaskStartTime: vi.fn(),
    recordTaskEndTime: vi.fn(),
  };
}

function createLongTaskReporter(): LongTaskReporter {
  return { reportLongTasks: vi.fn() };
}
