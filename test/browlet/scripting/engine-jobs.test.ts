import { afterEach, describe, expect, vi } from 'vitest';
import { createManualUserAgent } from '../../support/browlet-agent';
import { createTestDocument } from '../../support/dom';
import { itPassesWith } from '../../test-runtime';
import { getRelevantRealm } from '../../support/browlet-binding';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/document-state';
import { createSessionHistoryEntry } from '../../../src/browlet/browsing/navigation/session-history';
import { Duration } from '../../../src/browlet/timing/clock';
import { type Task } from '../../../src/browlet/scripting/event-loop';
import {
  installHostHooks, jsEngineTaskSource,
} from '../../../src/browlet/scripting/host-hooks';

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

    expect(fixture.loop.runTaskTurn()).toBe(true);
    expect(fixture.observations.map((item) => item.value)).toEqual(['ok']);
    expect(task?.scriptEvaluationEnvironments).toEqual(new Set());
    expect(fixture.observations[0]?.task?.source.name).toBe('microtask');
    expect(fixture.observations[0]?.task?.scriptEvaluationEnvironments)
      .toEqual(new Set([fixture.realm.env]));
    expect(fixture.loop.currentlyRunningTask).toBeNull();
  });

  itPassesWith('hostHooks')('counts fully-active time, then queues an engine task for the timeout', () => {
    const fixture = createFixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0;
    vi.spyOn(fixture.realm.env.timing, 'currentHighResolutionTime')
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
    const otherDocument = createTestDocument(fixture.realm.env);
    otherDocument.browsingContext = fixture.traversable.activeBrowsingContext;
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
    expect(fixture.loop.runTaskTurn()).toBe(true);
    expect(fixture.observations.map((item) => item.value)).toEqual(['timed-out']);
    expect(task?.scriptEvaluationEnvironments).toEqual(new Set());
    expect(fixture.observations[0]?.task?.source.name).toBe('microtask');
  });
});

function createFixture() {
  installHostHooks();
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = traversable.activeDocument!;
  const realm = getRelevantRealm(document);
  const loop = realm.agent.eventLoop;
  // The embedder supplies shared memory; this does not expose its constructor
  // on a Window that has not opted into cross-origin isolation.
  const array = new Int32Array(new SharedArrayBuffer(8));
  const observations: { value: string; task: Task | null; }[] = [];
  Reflect.set(realm.globalObject, 'waitArray', array);
  Reflect.set(realm.globalObject, 'observe', (value: string) => {
    observations.push({ value, task: loop.currentlyRunningTask });
  });
  return {
    array, document, loop, observations, realm, traversable,
    jobs: loop.getTaskQueue(jsEngineTaskSource),
  };
}
