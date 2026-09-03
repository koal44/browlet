import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import {
  type JavaScriptMicrotaskQueue,
} from '../../../../src/js-engine/index';
import {
  EventLoop, createTaskSource, type EventLoopOptions,
  type LongTaskReporter, Task, type TaskTimingHooks,
} from '../../../../src/browlet/scripting/event-loop';
import {
  domManipulationTaskSource, navigationAndTraversalTaskSource,
  networkingTaskSource, queueGlobalTask, queueTask, renderingTaskSource,
  userInteractionTaskSource,
} from '../../../../src/browlet/scripting/tasks';
import {
  createNewTopLevelTraversable,
} from '../../../../src/browlet/browsing/navigable';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { Realm } from '../../../../src/browlet/scripting/realm';
import {
  monotonicClock, UnsafeMoment,
} from '../../../../src/browlet/performance/clock';
import { itCompatPasses } from '../../../test-runtime';

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

    queueTask(source, eventLoop, null, first);
    queueTask(source, eventLoop, null, second);

    const tasks = [...EventLoop.getTaskQueue(eventLoop, source)];
    expect(tasks.every((task) => task instanceof Task)).toBe(true);
    expect(tasks.map((task) => task.steps)).toEqual([first, second]);
    expect(tasks.map((task) => task.source)).toEqual([source, source]);
    expect(tasks.map((task) => task.document)).toEqual([null, null]);
    expect(tasks.every((task) =>
      task.scriptEvaluationEnvironmentSettingsObjectSet.size === 0,
    )).toBe(true);
  });

  it('removes only the queued global task identified by a handle', () => {
    const traversable = createNewTopLevelTraversable(
      new UserAgent(),
      null,
      '',
    );
    const window = traversable.activeWindow;
    if (window === null) throw new Error('Expected an active Window');
    const first = vi.fn();
    const second = vi.fn();
    const source = createTaskSource('removable');
    const firstTask = queueGlobalTask(source, window, first);

    queueGlobalTask(source, window, second);

    expect(firstTask.remove()).toBe(true);
    expect(firstTask.remove()).toBe(false);
    expect(requireEventLoop(window).runTaskTurn(
      createEventLoopOptions(),
    )).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('associates sources independently on each event loop', () => {
    const firstLoop = createEventLoop();
    const secondLoop = createEventLoop();
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
    const microtaskQueue = createMicrotaskQueue({
      performMicrotaskCheckpoint() {
        expect(eventLoop.currentlyRunningTask).toBeNull();
        order.push('checkpoint');
      },
    });
    const eventLoop = new EventLoop(microtaskQueue);
    const source = createTaskSource('turn');
    const inactiveDocument = new DocumentImpl();
    const inactiveSteps = vi.fn();
    const order: string[] = [];
    const runnableSteps = vi.fn(() => {
      expect(eventLoop.currentlyRunningTask?.steps).toBe(runnableSteps);
      order.push('task');
    });
    const eventLoopOptions = createEventLoopOptions();

    queueTask(source, eventLoop, inactiveDocument, inactiveSteps);
    queueTask(source, eventLoop, null, runnableSteps);

    expect(eventLoop.runTaskTurn(eventLoopOptions)).toBe(true);

    expect(order).toEqual(['task', 'checkpoint']);
    expect(inactiveSteps).not.toHaveBeenCalled();
    expect([...EventLoop.getTaskQueue(eventLoop, source)]
      .map((task) => task.steps)).toEqual([inactiveSteps]);
  });

  it('lets scheduling policy choose among runnable task queues', () => {
    const eventLoop = createEventLoop();
    const firstSource = createTaskSource('first');
    const secondSource = createTaskSource('second');
    const first = vi.fn();
    const second = vi.fn();
    const firstQueue = EventLoop.getTaskQueue(eventLoop, firstSource);
    const secondQueue = EventLoop.getTaskQueue(eventLoop, secondSource);
    const selectTaskQueue = vi.fn(
      (queues: readonly ReadonlySet<Task>[]) => queues[1]!,
    );

    queueTask(firstSource, eventLoop, null, first);
    queueTask(secondSource, eventLoop, null, second);

    eventLoop.runTaskTurn({
      ...createEventLoopOptions(),
      selectTaskQueue,
    });

    expect(selectTaskQueue).toHaveBeenCalledWith([firstQueue, secondQueue]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('leaves unrunnable tasks queued without checkpointing', () => {
    const checkpoint = vi.fn();
    const microtaskQueue = createMicrotaskQueue({
      performMicrotaskCheckpoint: checkpoint,
    });
    const eventLoop = new EventLoop(microtaskQueue);
    const source = createTaskSource('inactive');
    const steps = vi.fn();
    const eventLoopOptions = createEventLoopOptions();

    queueTask(source, eventLoop, new DocumentImpl(), steps);

    expect(eventLoop.runTaskTurn(eventLoopOptions)).toBe(false);
    expect(steps).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
    expect(EventLoop.getTaskQueue(eventLoop, source).size).toBe(1);
  });

  it('clears the current task and checkpoints when task steps throw', () => {
    const checkpoint = vi.fn();
    const microtaskQueue = createMicrotaskQueue({
      performMicrotaskCheckpoint: checkpoint,
    });
    const eventLoop = new EventLoop(microtaskQueue);
    const source = createTaskSource('throwing');
    const error = new Error('task failed');
    const eventLoopOptions = createEventLoopOptions();
    const longTaskReporter = createLongTaskReporter();

    queueTask(source, eventLoop, null, () => { throw error; });

    expect(() => eventLoop.runTaskTurn({
      ...eventLoopOptions,
      longTaskReporter,
    })).toThrow(error);
    expect(eventLoop.currentlyRunningTask).toBeNull();
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(longTaskReporter.reportLongTasks).toHaveBeenCalledOnce();
  });

  it('accounts for a task around its steps and checkpoint', () => {
    const order: string[] = [];
    const microtaskQueue = createMicrotaskQueue({
      performMicrotaskCheckpoint() { order.push('checkpoint'); },
    });
    const eventLoop = new EventLoop(microtaskQueue);
    const source = createTaskSource('accounting');
    const traversable = createNewTopLevelTraversable(
      new UserAgent(),
      null,
      '',
    );
    const document = traversable.activeDocument;
    if (document === null) {
      throw new Error('Expected an active Document');
    }
    const startTime = new UnsafeMoment(monotonicClock, 10);
    const endTime = new UnsafeMoment(monotonicClock, 20);
    const times = [startTime, endTime];
    const eventLoopOptions = createEventLoopOptions({
      unsafeSharedCurrentTime() {
        const time = times.shift();
        if (time === undefined) throw new Error('Unexpected clock read');
        return time;
      },
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
      ...eventLoopOptions,
      longTaskReporter,
      taskTiming,
    });

    expect(order).toEqual([
      'start', 'task', 'checkpoint', 'long task', 'end',
    ]);
    expect(times).toEqual([]);
  });

  it('omits Document timing hooks for a null-Document task', () => {
    const eventLoop = createEventLoop();
    const source = createTaskSource('null Document');
    const longTaskReporter = createLongTaskReporter();
    const taskTiming = createTaskTimingHooks();

    queueTask(source, eventLoop, null, vi.fn());
    eventLoop.runTaskTurn({
      ...createEventLoopOptions(),
      longTaskReporter,
      taskTiming,
    });

    expect(taskTiming.recordTaskStartTime).not.toHaveBeenCalled();
    expect(longTaskReporter.reportLongTasks).toHaveBeenCalledOnce();
    expect(taskTiming.recordTaskEndTime).not.toHaveBeenCalled();
  });

  it('coalesces host wake-ups and requests one later turn per task', () => {
    const order: string[] = [];
    const microtaskQueue = createMicrotaskQueue({
      performMicrotaskCheckpoint() { order.push('checkpoint'); },
    });
    const eventLoop = new EventLoop(microtaskQueue);
    const source = createTaskSource('scheduled');
    const turns: (() => void)[] = [];
    const eventLoopOptions = createEventLoopOptions({
      requestEventLoopTurn(steps) { turns.push(steps); },
    });

    queueTask(source, eventLoop, null, () => { order.push('first'); });
    queueTask(source, eventLoop, null, () => { order.push('second'); });
    eventLoop.start(eventLoopOptions);

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
    const eventLoop = createEventLoop();
    const source = createTaskSource('late');
    const turns: (() => void)[] = [];
    const eventLoopOptions = createEventLoopOptions({
      requestEventLoopTurn(steps) { turns.push(steps); },
    });

    eventLoop.start(eventLoopOptions);
    expect(turns).toEqual([]);

    queueTask(source, eventLoop, null, vi.fn());
    queueTask(source, eventLoop, null, vi.fn());
    expect(turns).toHaveLength(1);
  });

  it('does not request a host turn for inactive Document work', () => {
    const eventLoop = createEventLoop();
    const source = createTaskSource('inactive scheduled');
    const eventLoopOptions = createEventLoopOptions();

    eventLoop.start(eventLoopOptions);
    queueTask(source, eventLoop, new DocumentImpl(), vi.fn());

    expect(eventLoopOptions.requestEventLoopTurn).not.toHaveBeenCalled();
  });

  it('does not enter another task turn while one is running', () => {
    const eventLoop = createEventLoop();
    const source = createTaskSource('reentrant');
    const options = createEventLoopOptions();
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
    expect(task!.document).toBe(document);
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
    let queuedSteps: (() => void) | undefined;
    const microtaskQueue = createMicrotaskQueue({
      enqueueMicrotask(steps) { queuedSteps = steps; },
    });
    const eventLoop = new EventLoop(microtaskQueue);
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
    const eventLoop = new EventLoop(microtaskQueue);
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
    const eventLoop = new EventLoop(microtaskQueue);

    eventLoop.queueMicrotask(() => {
      eventLoop.performMicrotaskCheckpoint();
    });
    queuedSteps?.();

    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('clears an outer task after a nested microtask runs', () => {
    let queuedSteps: (() => void) | undefined;
    const eventLoop = new EventLoop(createMicrotaskQueue({
      enqueueMicrotask(steps) { queuedSteps = steps; },
    }));
    const source = createTaskSource('outer');
    const microtask = vi.fn();
    const outer = vi.fn(() => {
      eventLoop.queueMicrotask(microtask);
      queuedSteps?.();
      expect(eventLoop.currentlyRunningTask).toBeNull();
    });

    queueTask(source, eventLoop, null, outer);
    eventLoop.runTaskTurn(createEventLoopOptions());

    expect(microtask).toHaveBeenCalledOnce();
    expect(eventLoop.currentlyRunningTask).toBeNull();
  });

  itCompatPasses(
    'does not report an adopted Stream start rejection as unhandled',
    () => {
      /*
       * The parser enters this script from a host Promise job. V8 declines the
       * nested checkpoint, but Node's `_tickCallback` still reports rejected
       * promises, producing `unhandled boo!`, `handled later`, then `done`.
       */
      const events = runNodeProbe(`
        const { Browlet } = require('./src/browlet/browlet.ts');
        process.on('unhandledRejection', reason => {
          console.log('unhandled', reason.name);
        });
        process.on('rejectionHandled', () => console.log('handled later'));

        void (async () => {
          const browlet = new Browlet({
            route: () => \`<script>
              new ReadableStream({
                start() {
                  return Promise.reject({ name: 'boo!' });
                }
              });
            </script>\`,
          });
          await browlet.navigate('http://example.test/');
          setImmediate(() => console.log('done'));
        })();
      `);

      expect(events).toEqual(['done']);
    },
  );

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

    expect(createTask(null).isRunnable).toBe(true);
    expect(createTask(activeDocument).isRunnable).toBe(true);
    expect(createTask(inactiveDocument).isRunnable).toBe(false);
  });
});

function requireEventLoop(global: object): EventLoop {
  const realm = Realm.getAssociatedRealm(global);
  if (realm === undefined) throw new Error('Expected a relevant Realm');
  return realm.agent.eventLoop;
}

function createTask(document: DocumentImpl | null): Task {
  return new Task(createTaskSource('runnable'), document, () => {});
}

function createEventLoop(): EventLoop {
  return new EventLoop(createMicrotaskQueue());
}

function createMicrotaskQueue(
  overrides: Partial<JavaScriptMicrotaskQueue> = {},
): JavaScriptMicrotaskQueue {
  return {
    kind: overrides.kind ?? 'explicit',
    enqueueMicrotask: vi.fn(overrides.enqueueMicrotask ?? (() => {})),
    performMicrotaskCheckpoint: vi.fn(
      overrides.performMicrotaskCheckpoint ?? (() => {}),
    ),
  };
}

function createEventLoopOptions(
  overrides: Partial<EventLoopOptions> = {},
): EventLoopOptions {
  return {
    createMicrotaskQueue: overrides.createMicrotaskQueue ??
      (() => createMicrotaskQueue()),
    requestEventLoopTurn: vi.fn(
      overrides.requestEventLoopTurn ?? (() => {}),
    ),
    unsafeSharedCurrentTime: vi.fn(
      overrides.unsafeSharedCurrentTime ??
      (() => new UnsafeMoment(monotonicClock, 0)),
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

function runNodeProbe(source: string): string[] {
  const result = spawnSync(
    process.execPath,
    ['--import=tsx', '--eval', source],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Node checkpoint probe failed', {
      cause: result.stderr,
    });
  }
  return result.stdout.split(/\r?\n/u).filter((line) => line !== '');
}
