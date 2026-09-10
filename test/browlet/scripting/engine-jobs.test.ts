import { afterEach, describe, expect, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';
import { jsRuntime } from '../../../src/js-engine/index';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { createNewTopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import {
  createDocumentState, createSessionHistoryEntry,
} from '../../../src/browlet/browsing/navigation/session-history';
import { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { Duration } from '../../../src/browlet/performance/clock';
import { unsafeSharedCurrentTime } from '../../../src/browlet/performance/high-resolution-time';
import { EventLoop, type Task } from '../../../src/browlet/scripting/event-loop';
import {
  installHostHooks, jsEngineTaskSource,
} from '../../../src/browlet/scripting/host-hooks';
import { UserAgent } from '../../../src/browlet/user-agent';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('HTML generic and timeout jobs', () => {
  itPassesWith('hostHooks')('delivers a notification as an engine task before running its Promise reaction', async () => {
    const fixture = createFixture();
    fixture.realm.evaluate(`
      Atomics.waitAsync(waitArray, 0, 0).value.then(value => observe(value));
    `, 'notification.js');
    expect(Atomics.notify(fixture.array, 0)).toBe(1);

    await expect.poll(() => fixture.jobs.size).toBe(1);
    const [task] = fixture.jobs;
    expect(task?.document).toBe(fixture.document);
    fixture.loop.performMicrotaskCheckpoint();
    expect(fixture.observations).toEqual([]);

    expect(fixture.loop.runTaskTurn(fixture.options)).toBe(true);
    expect(fixture.observations.map((item) => item.value)).toEqual(['ok']);
    expect(task?.scriptEvaluationEnvironmentSettingsObjectSet).toEqual(new Set());
    expect(fixture.observations[0]?.task?.source.name).toBe('microtask');
    expect(fixture.observations[0]?.task?.scriptEvaluationEnvironmentSettingsObjectSet)
      .toEqual(new Set([fixture.realm.hostDefined]));
    expect(fixture.loop.currentlyRunningTask).toBeNull();
  });

  itPassesWith('hostHooks')('counts fully-active time, then queues an engine task for the timeout', () => {
    const fixture = createFixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0;
    vi.spyOn(fixture.realm.hostDefined!.timing, 'currentHighResolutionTime')
      .mockImplementation(() => new Duration(now));
    const advance = (milliseconds: number) => {
      now += milliseconds;
      vi.advanceTimersByTime(milliseconds);
    };
    fixture.realm.evaluate(`
      Atomics.waitAsync(waitArray, 0, 0, 1000).value.then(value => observe(value));
    `, 'timeout.js');
    expect(vi.getTimerCount()).toBe(1);
    advance(400);

    const activeEntry = fixture.traversable.activeSessionHistoryEntry;
    const otherDocument = new DocumentImpl();
    DocumentImpl.setBrowsingContext(otherDocument, fixture.traversable.activeBrowsingContext);
    fixture.traversable.activeSessionHistoryEntry =
      createSessionHistoryEntry(createDocumentState(otherDocument));
    advance(10000);
    expect(fixture.jobs.size).toBe(0);
    expect(fixture.observations).toEqual([]);

    fixture.traversable.activeSessionHistoryEntry = activeEntry;
    advance(500);
    expect(fixture.jobs.size).toBe(0);
    advance(100);
    expect(fixture.jobs.size).toBe(1);
    const [task] = fixture.jobs;
    expect(task?.document).toBe(fixture.document);
    fixture.loop.performMicrotaskCheckpoint();
    expect(fixture.observations).toEqual([]);
    expect(fixture.loop.runTaskTurn(fixture.options)).toBe(true);
    expect(fixture.observations.map((item) => item.value)).toEqual(['timed-out']);
    expect(task?.scriptEvaluationEnvironmentSettingsObjectSet).toEqual(new Set());
    expect(fixture.observations[0]?.task?.source.name).toBe('microtask');
  });
});

function createFixture() {
  installHostHooks();
  const options = {
    createMicrotaskQueue: jsRuntime.createMicrotaskQueue,
    requestEventLoopTurn: vi.fn(),
    unsafeSharedCurrentTime,
  };
  const traversable = createNewTopLevelTraversable(new UserAgent(options), null, '');
  const document = traversable.activeDocument!;
  const realm = getRelevantRealm(traversable.activeBrowsingContext!.windowProxy);
  const loop = realm.agent.eventLoop;
  // The embedder supplies shared memory; this does not expose its constructor
  // on a Window that has not opted into cross-origin isolation.
  const array = new Int32Array(new SharedArrayBuffer(8));
  const observations: { value: string; task: Task | null; }[] = [];
  Reflect.set(realm.global, 'waitArray', array);
  Reflect.set(realm.global, 'observe', (value: string) => {
    observations.push({ value, task: loop.currentlyRunningTask });
  });
  return {
    array, document, loop, observations, options, realm, traversable,
    jobs: EventLoop.getTaskQueue(loop, jsEngineTaskSource),
  };
}
