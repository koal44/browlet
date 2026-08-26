import { describe, expect, it, vi } from 'vitest';

import {
  EventLoop, createTaskSource, type Task,
} from '../../../../src/browlet/scripting/event-loop';
import {
  queueGlobalTask, queueTask,
} from '../../../../src/browlet/scripting/tasks';
import {
  createNewTopLevelTraversable, isTaskRunnable,
} from '../../../../src/browlet/browsing/navigable';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { Realm } from '../../../../src/browlet/scripting/realm';

describe('task queues', () => {
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
