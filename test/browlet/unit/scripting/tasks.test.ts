import { describe, expect, it, vi } from 'vitest';

import {
  EventLoop, createTaskSource, type LongTaskReporter, type Task,
  type TaskTimingHooks,
} from '../../../../src/browlet/scripting/event-loop';
import {
  domManipulationTaskSource, navigationAndTraversalTaskSource,
  networkingTaskSource, queueGlobalTask, queueTask, renderingTaskSource,
  userInteractionTaskSource,
} from '../../../../src/browlet/scripting/tasks';
import {
  createNewTopLevelTraversable, isTaskRunnable,
} from '../../../../src/browlet/browsing/navigable';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { Realm } from '../../../../src/browlet/scripting/realm';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import {
  nodeSchedulerHost, type SchedulerHost,
} from '../../../../src/browlet/scripting/scheduler-host';
import {
  monotonicClock, UnsafeMoment,
} from '../../../../src/browlet/performance/clock';

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
    const eventLoop = new EventLoop();
    const source = createTaskSource('test');
    const first = vi.fn();
    const second = vi.fn();

    queueTask(source, eventLoop, null, first);
    queueTask(source, eventLoop, null, second);

    const tasks = [...EventLoop.getTaskQueue(eventLoop, source)];
    expect(tasks.map((task) => task.steps)).toEqual([first, second]);
    expect(tasks.map((task) => task.source)).toEqual([source, source]);
    expect(tasks.map((task) => task.document)).toEqual([null, null]);
    expect(tasks.every((task) =>
      task.scriptEvaluationEnvironmentSettingsObjectSet.size === 0,
    )).toBe(true);
  });

  it('associates sources independently on each event loop', () => {
    const firstLoop = new EventLoop();
    const secondLoop = new EventLoop();
    const firstSource = createTaskSource('same diagnostic name');
    const secondSource = createTaskSource('same diagnostic name');

    queueTask(firstSource, firstLoop, null, vi.fn());
    queueTask(secondSource, firstLoop, null, vi.fn());
    queueTask(firstSource, secondLoop, null, vi.fn());

    expect(EventLoop.getTaskQueues(firstLoop).size).toBe(2);
    expect(EventLoop.getTaskQueues(secondLoop).size).toBe(1);
    expect(EventLoop.getTaskQueue(firstLoop, firstSource)).not.toBe(
      EventLoop.getTaskQueue(secondLoop, firstSource),
    );
  });

  it('runs the oldest runnable task and then reaches its checkpoint', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('turn');
    const inactiveDocument = new DocumentImpl();
    const inactiveSteps = vi.fn();
    const order: string[] = [];
    const runnableSteps = vi.fn(() => {
      expect(eventLoop.currentlyRunningTask?.steps).toBe(runnableSteps);
      order.push('task');
    });
    const schedulerHost = createSchedulerHost({
      performMicrotaskCheckpoint() {
        expect(eventLoop.currentlyRunningTask).toBeNull();
        order.push('checkpoint');
      },
    });

    queueTask(source, eventLoop, inactiveDocument, inactiveSteps);
    queueTask(source, eventLoop, null, runnableSteps);

    expect(eventLoop.runTaskTurn({
      isTaskRunnable,
      schedulerHost,
    })).toBe(true);

    expect(order).toEqual(['task', 'checkpoint']);
    expect(inactiveSteps).not.toHaveBeenCalled();
    expect([...EventLoop.getTaskQueue(eventLoop, source)]
      .map((task) => task.steps)).toEqual([inactiveSteps]);
  });

  it('lets scheduling policy choose among runnable task queues', () => {
    const eventLoop = new EventLoop();
    const firstSource = createTaskSource('first');
    const secondSource = createTaskSource('second');
    const first = vi.fn();
    const second = vi.fn();
    const firstQueue = EventLoop.getTaskQueue(eventLoop, firstSource);
    const secondQueue = EventLoop.getTaskQueue(eventLoop, secondSource);
    const selectTaskQueue = vi.fn(
      (queues: readonly ReadonlySet<Task>[]) => queues[1],
    );

    queueTask(firstSource, eventLoop, null, first);
    queueTask(secondSource, eventLoop, null, second);

    eventLoop.runTaskTurn({
      isTaskRunnable,
      schedulerHost: createSchedulerHost(),
      selectTaskQueue,
    });

    expect(selectTaskQueue).toHaveBeenCalledWith([firstQueue, secondQueue]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('leaves unrunnable tasks queued without checkpointing', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('inactive');
    const steps = vi.fn();
    const schedulerHost = createSchedulerHost();

    queueTask(source, eventLoop, new DocumentImpl(), steps);

    expect(eventLoop.runTaskTurn({
      isTaskRunnable,
      schedulerHost,
    })).toBe(false);
    expect(steps).not.toHaveBeenCalled();
    expect(schedulerHost.performMicrotaskCheckpoint).not.toHaveBeenCalled();
    expect(EventLoop.getTaskQueue(eventLoop, source).size).toBe(1);
  });

  it('clears the current task and checkpoints when task steps throw', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('throwing');
    const error = new Error('task failed');
    const schedulerHost = createSchedulerHost();
    const longTaskReporter = createLongTaskReporter();

    queueTask(source, eventLoop, null, () => { throw error; });

    expect(() => eventLoop.runTaskTurn({
      isTaskRunnable,
      longTaskReporter,
      schedulerHost,
    })).toThrow(error);
    expect(eventLoop.currentlyRunningTask).toBeNull();
    expect(schedulerHost.performMicrotaskCheckpoint).toHaveBeenCalledOnce();
    expect(longTaskReporter.reportLongTasks).toHaveBeenCalledOnce();
  });

  it('accounts for a task around its steps and checkpoint', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('accounting');
    const document = new DocumentImpl();
    const order: string[] = [];
    const startTime = new UnsafeMoment(monotonicClock, 10);
    const endTime = new UnsafeMoment(monotonicClock, 20);
    const times = [startTime, endTime];
    const schedulerHost = createSchedulerHost({
      unsafeSharedCurrentTime() {
        const time = times.shift();
        if (time === undefined) throw new Error('Unexpected clock read');
        return time;
      },
      performMicrotaskCheckpoint() { order.push('checkpoint'); },
    });
    queueTask(source, eventLoop, document, () => { order.push('task'); });
    const [task] = EventLoop.getTaskQueue(eventLoop, source);
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

    eventLoop.runTaskTurn({
      isTaskRunnable: () => true,
      longTaskReporter,
      schedulerHost,
      taskTiming,
    });

    expect(order).toEqual([
      'start', 'task', 'checkpoint', 'long task', 'end',
    ]);
    expect(times).toEqual([]);
  });

  it('omits Document timing hooks for a null-Document task', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('null Document');
    const longTaskReporter = createLongTaskReporter();
    const taskTiming = createTaskTimingHooks();

    queueTask(source, eventLoop, null, vi.fn());
    eventLoop.runTaskTurn({
      isTaskRunnable,
      longTaskReporter,
      schedulerHost: createSchedulerHost(),
      taskTiming,
    });

    expect(taskTiming.recordTaskStartTime).not.toHaveBeenCalled();
    expect(longTaskReporter.reportLongTasks).toHaveBeenCalledOnce();
    expect(taskTiming.recordTaskEndTime).not.toHaveBeenCalled();
  });

  it('coalesces host wake-ups and requests one later turn per task', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('scheduled');
    const turns: (() => void)[] = [];
    const order: string[] = [];
    const schedulerHost = createSchedulerHost({
      requestEventLoopTurn(steps) { turns.push(steps); },
      performMicrotaskCheckpoint() { order.push('checkpoint'); },
    });

    queueTask(source, eventLoop, null, () => { order.push('first'); });
    queueTask(source, eventLoop, null, () => { order.push('second'); });
    eventLoop.start({ isTaskRunnable, schedulerHost });

    expect(turns).toHaveLength(1);
    turns.shift()?.();
    expect(order).toEqual(['first', 'checkpoint']);
    expect(turns).toHaveLength(1);
    turns.shift()?.();
    expect(order).toEqual([
      'first', 'checkpoint', 'second', 'checkpoint',
    ]);
    expect(turns).toEqual([]);
  });

  it('requests a host turn when runnable work arrives after startup', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('late');
    const turns: (() => void)[] = [];
    const schedulerHost = createSchedulerHost({
      requestEventLoopTurn(steps) { turns.push(steps); },
    });

    eventLoop.start({ isTaskRunnable, schedulerHost });
    expect(turns).toEqual([]);

    queueTask(source, eventLoop, null, vi.fn());
    queueTask(source, eventLoop, null, vi.fn());
    expect(turns).toHaveLength(1);
  });

  it('does not request a host turn for inactive Document work', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('inactive scheduled');
    const schedulerHost = createSchedulerHost();

    eventLoop.start({ isTaskRunnable, schedulerHost });
    queueTask(source, eventLoop, new DocumentImpl(), vi.fn());

    expect(schedulerHost.requestEventLoopTurn).not.toHaveBeenCalled();
  });

  it('does not enter another task turn while one is running', () => {
    const eventLoop = new EventLoop();
    const source = createTaskSource('reentrant');
    const options = {
      isTaskRunnable,
      schedulerHost: createSchedulerHost(),
    };
    const second = vi.fn();

    queueTask(source, eventLoop, null, () => {
      expect(() => eventLoop.runTaskTurn(options)).toThrow(
        'An event loop cannot run a task reentrantly',
      );
    });
    queueTask(source, eventLoop, null, second);

    eventLoop.runTaskTurn(options);

    expect(second).not.toHaveBeenCalled();
    expect(EventLoop.getTaskQueue(eventLoop, source).size).toBe(1);
  });

  it('derives a Window task destination and Document from its Realm', () => {
    const traversable = createNewTopLevelTraversable(
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

    queueGlobalTask(source, window, vi.fn());

    const [task] = EventLoop.getTaskQueue(requireEventLoop(window), source);
    expect(task.document).toBe(document);
  });

  it('captures the surrounding Window Realm Document for a microtask', () => {
    const traversable = createNewTopLevelTraversable(
      new UserAgent(),
      null,
      '',
    );
    const window = traversable.activeWindow;
    const document = traversable.activeDocument;
    if (window === null || document === null) {
      throw new Error('Expected a complete top-level traversable');
    }
    const realm = Realm.getAssociatedRealm(window);
    if (realm === undefined) throw new Error('Expected a relevant Realm');
    const steps = vi.fn();
    const queueMicrotask = vi.spyOn(realm.agent.eventLoop, 'queueMicrotask')
      .mockImplementation(() => {});

    realm.queueMicrotask(steps);

    expect(queueMicrotask).toHaveBeenCalledWith(steps, document);
  });

  it('identifies a microtask as the currently running task', () => {
    const eventLoop = new EventLoop();
    let queuedSteps: (() => void) | undefined;
    const hostQueueMicrotask = vi.spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((steps) => { queuedSteps = steps; });
    const steps = vi.fn(() => {
      expect(eventLoop.currentlyRunningTask?.steps).toBe(steps);
    });

    eventLoop.queueMicrotask(steps);
    queuedSteps?.();

    expect(steps).toHaveBeenCalledOnce();
    expect(eventLoop.currentlyRunningTask).toBeNull();
    hostQueueMicrotask.mockRestore();
  });

  it('suppresses reentrant microtask checkpoints', () => {
    const eventLoop = new EventLoop();
    const schedulerHost = createSchedulerHost({
      performMicrotaskCheckpoint() {
        eventLoop.performMicrotaskCheckpoint(schedulerHost);
      },
    });

    eventLoop.performMicrotaskCheckpoint(schedulerHost);

    expect(schedulerHost.performMicrotaskCheckpoint).toHaveBeenCalledOnce();
  });

  it('drains shared same-agent Realm promise jobs in FIFO order', async () => {
    await runInHostTask(() => {
      const agent = new WindowAgent();
      const firstRealm = new Realm({ agent });
      const secondRealm = new Realm({ agent });
      const order: string[] = [];

      Reflect.set(firstRealm.globalObject, 'record', (value: string) => {
        order.push(value);
      });
      Reflect.set(secondRealm.globalObject, 'record', (value: string) => {
        order.push(value);
      });
      firstRealm.evaluate(`
        Promise.resolve().then(() => {
          record('A1');
          Promise.resolve().then(() => record('A2'));
        });
      `, 'first-realm.js');
      secondRealm.evaluate(
        `Promise.resolve().then(() => record('B1'));`,
        'second-realm.js',
      );

      agent.eventLoop.performMicrotaskCheckpoint(nodeSchedulerHost);

      expect(order).toEqual(['A1', 'B1', 'A2']);
    });
  });

  it.fails('isolates checkpoints from ambient Node next ticks', async () => {
    await runInHostTask(() => {
      const order: string[] = [];

      process.nextTick(() => { order.push('ambient next tick'); });
      queueMicrotask(() => { order.push('microtask'); });
      new EventLoop().performMicrotaskCheckpoint(nodeSchedulerHost);

      expect(order).toEqual(['microtask']);
    });
  });

  it.fails('drains jobs when entered from a host microtask', async () => {
    await Promise.resolve();
    const order: string[] = [];

    queueMicrotask(() => { order.push('nested microtask'); });
    new EventLoop().performMicrotaskCheckpoint(nodeSchedulerHost);

    expect(order).toEqual(['nested microtask']);
  });

  it.fails('drains jobs when a test clock runs a host task synchronously', () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];

      setImmediate(() => {
        queueMicrotask(() => { order.push('microtask'); });
        new EventLoop().performMicrotaskCheckpoint(nodeSchedulerHost);
        expect(order).toEqual(['microtask']);
      });
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes only null-Document or fully-active tasks runnable', () => {
    const traversable = createNewTopLevelTraversable(
      new UserAgent(),
      null,
      '',
    );
    const activeDocument = traversable.activeDocument;
    const browsingContext = traversable.activeBrowsingContext;
    if (activeDocument === null || browsingContext === null) {
      throw new Error('Expected a complete top-level traversable');
    }
    const inactiveDocument = new DocumentImpl();
    DocumentImpl.setBrowsingContext(inactiveDocument, browsingContext);

    expect(isTaskRunnable(createTask(null))).toBe(true);
    expect(isTaskRunnable(createTask(activeDocument))).toBe(true);
    expect(isTaskRunnable(createTask(inactiveDocument))).toBe(false);
  });
});

function requireEventLoop(global: object): EventLoop {
  const realm = Realm.getAssociatedRealm(global);
  if (realm === undefined) throw new Error('Expected a relevant Realm');
  return realm.agent.eventLoop;
}

function createTask(document: DocumentImpl | null): Task {
  return {
    steps() {},
    source: createTaskSource('runnable'),
    document,
    scriptEvaluationEnvironmentSettingsObjectSet: new Set(),
  };
}

function createSchedulerHost(
  overrides: Partial<SchedulerHost> = {},
): SchedulerHost {
  return {
    requestEventLoopTurn: vi.fn(
      overrides.requestEventLoopTurn ?? (() => {}),
    ),
    unsafeSharedCurrentTime: vi.fn(
      overrides.unsafeSharedCurrentTime ??
      (() => new UnsafeMoment(monotonicClock, 0)),
    ),
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

function runInHostTask(steps: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        steps();
        resolve();
      } catch (error) {
        reject(error instanceof Error
          ? error
          : new Error('Host task failed', { cause: error }));
      }
    });
  });
}
