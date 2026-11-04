import { afterEach, describe, expect, vi } from 'vitest';
import { createManualUserAgent } from '../../support/browlet-agent';
import { createTestDocument } from '../../support/dom';
import { itPassesWith } from '../../test-runtime';
import { getRelevantRealm } from '../../support/browlet-binding';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { Duration } from '../../../src/browlet/timing/clock';
import { type Task } from '../../../src/browlet/scripting/event-loop';
import { installHostHooks } from '../../../src/browlet/scripting/host-hooks';
import { jsEngineTaskSource } from '../../../src/browlet/scripting/tasks';

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
    expect(task?.source).toBe(jsEngineTaskSource);
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

  itPassesWith('hostHooks')('uses the borrowed waitAsync realm and waits for its Document to become active', async () => {
    const caller = createFixture();
    const owner = createFixture(caller.traversable);
    expect(owner.loop).toBe(caller.loop);
    Reflect.set(caller.realm.globalObject, 'foreignWaitAsync', owner.realm.evaluate('Atomics.waitAsync', 'wait-function.js'));
    caller.realm.evaluate(`
      foreignWaitAsync(waitArray, 0, 0).value.then(value => observe(value));
    `, 'borrowed-wait.js');
    expect(Atomics.notify(caller.array, 0)).toBe(1);
    await expect.poll(() => owner.jobs.size).toBe(1);

    const [task] = owner.jobs;
    expect(task?.source).toBe(jsEngineTaskSource);
    expect(task?.document).toBe(owner.document);

    const activeEntry = owner.traversable.activeSessionHistoryEntry;
    const otherDocument = createTestDocument(owner.realm.env);
    otherDocument.browsingContext = owner.traversable.activeBrowsingContext;
    owner.traversable.activeSessionHistoryEntry = otherDocument.env.createSessionHistoryEntry(otherDocument.url, DocumentState.create(otherDocument));
    expect(owner.document.isFullyActive()).toBe(false);
    expect(caller.document.isFullyActive()).toBe(true);
    expect(owner.loop.runTaskTurn()).toBe(false);
    owner.loop.performMicrotaskCheckpoint();
    expect(caller.observations).toEqual([]);
    expect(owner.jobs.has(task!)).toBe(true);

    owner.traversable.activeSessionHistoryEntry = activeEntry;
    expect(owner.loop.runTaskTurn()).toBe(true);
    expect(owner.jobs.size).toBe(0);
    expect(owner.observations).toEqual([]);
    expect(caller.observations.map((item) => item.value)).toEqual(['ok']);
    expect(task?.scriptEvaluationEnvironments).toEqual(new Set());
    // The notification belongs to the waitAsync realm; the subsequent Promise
    // reaction uses its own callback's realm and the ordinary microtask path.
    expect(caller.observations[0]?.task?.source.name).toBe('microtask');
    expect(caller.observations[0]?.task?.scriptEvaluationEnvironments)
      .toEqual(new Set([caller.realm.env]));
    expect(owner.loop.currentlyRunningTask).toBeNull();
  });

  itPassesWith('hostHooks').each([false, true])('counts the wait-owning Window\'s active time before delivering its timeout (borrowed: %s)', (borrowed) => {
    const fixture = createFixture();
    const caller = borrowed ? createFixture(fixture.traversable) : fixture;
    Reflect.set(caller.realm.globalObject, 'wait', fixture.realm.evaluate('Atomics.waitAsync', 'wait-function.js'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0;
    vi.spyOn(fixture.realm.env.timing, 'currentHighResolutionTime')
      .mockImplementation(() => new Duration(now));
    const advance = (milliseconds: number) => {
      now += milliseconds;
      vi.advanceTimersByTime(milliseconds);
    };
    caller.realm.evaluate(`
      wait(waitArray, 0, 0, 1000).value.then(value => observe(value));
    `, 'timeout.js');
    expect(vi.getTimerCount()).toBe(1);
    advance(400);

    const activeEntry = fixture.traversable.activeSessionHistoryEntry;
    const otherDocument = createTestDocument(fixture.realm.env);
    otherDocument.browsingContext = fixture.traversable.activeBrowsingContext;
    fixture.traversable.activeSessionHistoryEntry =
      otherDocument.env.createSessionHistoryEntry(otherDocument.url, DocumentState.create(otherDocument));
    expect(caller.document.isFullyActive()).toBe(borrowed);
    advance(10000);
    expect(fixture.jobs.size).toBe(0);
    expect(caller.observations).toEqual([]);

    fixture.traversable.activeSessionHistoryEntry = activeEntry;
    advance(500);
    expect(fixture.jobs.size).toBe(0);
    advance(100);
    expect(fixture.jobs.size).toBe(1);
    const [task] = fixture.jobs;
    expect(task?.source).toBe(jsEngineTaskSource);
    expect(task?.document).toBe(fixture.document);
    expect(task?.timerNestingLevel).toBeUndefined();
    // Finishing the active-time wait only queues work. Becoming inactive again
    // before that task runs must still hold back the native timeout operation.
    fixture.traversable.activeSessionHistoryEntry =
      otherDocument.env.createSessionHistoryEntry(otherDocument.url, DocumentState.create(otherDocument));
    expect(fixture.loop.runTaskTurn()).toBe(false);
    fixture.loop.performMicrotaskCheckpoint();
    expect(caller.observations).toEqual([]);
    fixture.traversable.activeSessionHistoryEntry = activeEntry;
    expect(fixture.loop.runTaskTurn()).toBe(true);
    expect(caller.observations.map((item) => item.value)).toEqual(['timed-out']);
    expect(task?.scriptEvaluationEnvironments).toEqual(new Set());
    expect(caller.observations[0]?.task?.source.name).toBe('microtask');
    expect(caller.observations[0]?.task?.scriptEvaluationEnvironments)
      .toEqual(new Set([caller.realm.env]));
    expect(fixture.loop.currentlyRunningTask).toBeNull();
  });

  itPassesWith('hostHooks')('allows notification to cancel a queued timeout before its engine task runs', async () => {
    const fixture = createFixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0;
    vi.spyOn(fixture.realm.env.timing, 'currentHighResolutionTime')
      .mockImplementation(() => new Duration(now));
    fixture.realm.evaluate(`
      Atomics.waitAsync(waitArray, 0, 0, 1000).value.then(value => observe(value));
    `, 'timeout-notification-race.js');
    now = 1000;
    vi.advanceTimersByTime(1000);
    // Restore real host timers for the asynchronous native notification handoff.
    // The simulated timer has already completed; its engine task is still queued.
    vi.useRealTimers();
    expect(fixture.jobs.size).toBe(1);
    expect(fixture.observations).toEqual([]);

    expect(Atomics.notify(fixture.array, 0)).toBe(1);
    await expect.poll(() => fixture.jobs.size).toBe(2);
    // The older timeout task is now a no-op. It must not resolve as timed-out
    // before the later notification task settles the same Promise as ok.
    expect(fixture.loop.runTaskTurn()).toBe(true);
    expect(fixture.observations).toEqual([]);
    expect(fixture.loop.runTaskTurn()).toBe(true);
    expect(fixture.observations.map((item) => item.value)).toEqual(['ok']);
    expect(fixture.jobs.size).toBe(0);
    expect(fixture.loop.runTaskTurn()).toBe(false);
    expect(Atomics.notify(fixture.array, 0)).toBe(0);
  });
});

function createFixture(siblingOf?: TopLevelTraversable) {
  installHostHooks();
  const traversable = siblingOf === undefined
    ? TopLevelTraversable.create(createManualUserAgent(), null, '')
    : createSiblingTraversable(siblingOf);
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

function createSiblingTraversable(first: TopLevelTraversable): TopLevelTraversable {
  // Build the existing Window binding and activity relationships explicitly.
  // Auxiliary browsing-context creation still has an unfinished opener path.
  const sourceEnv = first.activeWindow!.env;
  const env = sourceEnv.userAgent.createWindowEnvironment({
    agent: sourceEnv.realm.agent, userAgent: sourceEnv.userAgent,
    creationURL: sourceEnv.creationURL, origin: sourceEnv.origin, parent: null,
    topLevelCreationURL: sourceEnv.creationURL, topLevelOrigin: sourceEnv.origin,
  });
  const document = env.createDocument();
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  document.makeActive();
  return new TopLevelTraversable(DocumentState.create(document));
}
