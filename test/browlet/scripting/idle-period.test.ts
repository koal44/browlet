import { afterEach, describe, expect, it, vi } from 'vitest';

import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { WindowImpl } from '../../../src/browlet/browsing/window/window';
import { WindowIdleCallbacks } from '../../../src/browlet/browsing/window/idle-callback';
import { DedicatedWorkerAgent, SandboxAgent } from '../../../src/browlet/scripting/agents';
import type { WindowIdleRendering } from '../../../src/browlet/scripting/event-loop';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { Moment, monotonicClock, UnsafeMoment } from '../../../src/timing/clock';

afterEach(() => { vi.restoreAllMocks(); });

describe('Window idle periods', () => {
  it('initializes both loop timestamps to zero', () => {
    const { loop, window } = createFixture();
    expect(loop.agent).toBe(window.env.realm.agent);
    expect(loop.lastIdlePeriodStartTime.milliseconds).toBe(0);
    expect(loop.lastRenderOpportunityTime.milliseconds).toBe(0);
  });

  it('caps a live deadline at 50 ms from the period start, not the read time', () => {
    const fixture = createFixture();
    expect(fixture.loop.runTaskTurn()).toBe(false);
    expect(fixture.loop.lastIdlePeriodStartTime.milliseconds).toBe(1000);
    expect(fixture.deadline().milliseconds).toBe(1050);

    fixture.setTime(1020);
    expect(fixture.deadline().milliseconds).toBe(1050);
    expect(fixture.loop.runTaskTurn()).toBe(false);
    expect(fixture.deadline().milliseconds).toBe(1070);
  });

  it('uses timers from every same-loop Window in shared time, including inactive Windows', () => {
    const fixture = createFixture();
    const other = createSameLoopWindow(fixture.window);
    const unrelated = TopLevelTraversable.create(fixture.userAgent, null, '').activeWindow!;
    vi.spyOn(fixture.window.env, 'timeOrigin', 'get').mockReturnValue(new Moment(monotonicClock, 900));
    vi.spyOn(other.env, 'timeOrigin', 'get').mockReturnValue(new Moment(monotonicClock, 200));
    expect(other.document.isFullyActive()).toBe(false);
    expect(unrelated.env.responsibleEventLoop).not.toBe(fixture.loop);
    timers(fixture.window).runStepsAfterTimeout('example', 40, () => {});
    timers(other).runStepsAfterTimeout('example', 12, () => {});
    timers(unrelated).runStepsAfterTimeout('example', 1, () => {});

    fixture.loop.runTaskTurn();

    expect([...fixture.deadlines.keys()]).toEqual([fixture.window.idleCallbacks, other.idleCallbacks]);
    expect(fixture.deadline().milliseconds).toBe(1012);
    expect(fixture.deadlines.get(other.idleCallbacks)!().milliseconds).toBe(1012);
  });

  it('rechecks timer estimates when the supplied deadline callback is called', () => {
    const fixture = createFixture();
    fixture.loop.runTaskTurn();
    const computeDeadline = fixture.deadlines.get(fixture.window.idleCallbacks)!;
    fixture.setTime(1005);
    timers(fixture.window).runStepsAfterTimeout('example', 5, () => {});
    expect(computeDeadline().milliseconds).toBe(1010);
    timers(fixture.window).clear();
    expect(computeDeadline().milliseconds).toBe(1050);
  });

  it('does not extend a retained deadline when a later idle period begins', () => {
    const fixture = createFixture();
    fixture.loop.runTaskTurn();
    const firstDeadline = fixture.deadlines.get(fixture.window.idleCallbacks)!;
    fixture.setTime(1060);
    fixture.loop.runTaskTurn();
    expect(fixture.deadline().milliseconds).toBe(1110);
    expect(firstDeadline().milliseconds).toBe(1050);
  });

  it('uses the next refresh only for pending rendering and keeps an earlier timer bound', () => {
    const fixture = createFixture();
    const other = createSameLoopWindow(fixture.window);
    fixture.loop.lastRenderOpportunityTime = new UnsafeMoment(monotonicClock, 1000);
    fixture.loop.runTaskTurn();
    expect(fixture.deadline().milliseconds).toBe(1050);
    expect(fixture.hooks.getRefreshRate).not.toHaveBeenCalled();

    fixture.hooks.hasPendingRenders.mockImplementation((window) => window === other);
    fixture.hooks.getRefreshRate.mockReturnValue(100);
    expect(fixture.deadline().milliseconds).toBe(1010);
    fixture.hooks.getRefreshRate.mockReturnValue(50);
    expect(fixture.deadline().milliseconds).toBe(1020);
    timers(fixture.window).runStepsAfterTimeout('example', 4, () => {});
    expect(fixture.deadline().milliseconds).toBe(1004);
    fixture.loop.lastRenderOpportunityTime = new UnsafeMoment(monotonicClock, 970);
    expect(fixture.deadline().milliseconds).toBe(990);
  });

  it('coarsens the deadline separately for each receiving Window', () => {
    const fixture = createFixture();
    const isolated = createSameLoopWindow(fixture.window);
    vi.spyOn(fixture.window.env, 'crossOriginIsolatedCapability', 'get').mockReturnValue(false);
    vi.spyOn(isolated.env, 'crossOriginIsolatedCapability', 'get').mockReturnValue(true);
    fixture.setTime(1000.129);

    fixture.loop.runTaskTurn();

    expect(fixture.deadline().milliseconds).toBe(1050.1);
    expect(fixture.deadlines.get(isolated.idleCallbacks)!().milliseconds).toBe(1050.125);
    expect(fixture.deadline().clock).toBe(monotonicClock);
    expect(fixture.deadline().coarsened).toBe(true);
  });

  // Real host turns let stock Node checkpoint outside Vitest's own microtask.
  it('starts only after the last runnable task and its checkpoint', () => runInHostTask(() => {
    const fixture = createFixture();
    const order: string[] = [];
    fixture.hooks.startIdlePeriod.mockImplementation(() => { order.push('idle'); });
    fixture.loop.queueTask(domManipulationTaskSource, null, { run: () => { order.push('first'); } });
    fixture.loop.queueTask(domManipulationTaskSource, null, {
      run: () => {
        order.push('last');
        fixture.loop.queueMicrotask(() => { order.push('checkpoint'); });
      },
    });

    expect(fixture.loop.runTaskTurn()).toBe(true);
    expect(order).toEqual(['first']);
    expect(fixture.loop.lastIdlePeriodStartTime.milliseconds).toBe(0);
    expect(fixture.loop.runTaskTurn()).toBe(true);
    expect(order).toEqual(['first', 'last', 'checkpoint', 'idle']);
  }));

  it('does not start while a checkpoint has queued another runnable task', () => runInHostTask(() => {
    const fixture = createFixture();
    fixture.loop.queueTask(domManipulationTaskSource, null, {
      run: () => {
        fixture.loop.queueMicrotask(() => {
          fixture.loop.queueTask(domManipulationTaskSource, null, { run: () => {} });
        });
      },
    });
    fixture.loop.runTaskTurn();
    expect(fixture.hooks.startIdlePeriod).not.toHaveBeenCalled();
    fixture.loop.runTaskTurn();
    expect(fixture.hooks.startIdlePeriod).toHaveBeenCalledOnce();
  }));

  it('allows idle work when the remaining task is blocked by document activity', () => {
    const fixture = createFixture();
    const steps = vi.fn();
    fixture.loop.queueTask(domManipulationTaskSource, fixture.window.document, { run: steps });
    const entry = fixture.traversable.activeSessionHistoryEntry;
    fixture.traversable.activeSessionHistoryEntry = fixture.window.env.createSessionHistoryEntry(entry.url, new DocumentState());

    expect(fixture.loop.runTaskTurn()).toBe(false);
    expect(steps).not.toHaveBeenCalled();
    expect(fixture.hooks.startIdlePeriod).toHaveBeenCalledOnce();
    expect(fixture.loop.getTaskQueue(domManipulationTaskSource).size).toBe(1);
  });

  it('starts after a checkpoint-only host turn and does not poll while idle', () => runInHostTask(() => {
    const fixture = createFixture();
    const steps = vi.fn();
    fixture.loop.queueMicrotask(steps);
    expect(fixture.turns).toHaveLength(1);

    fixture.turns.shift()!();

    expect(steps).toHaveBeenCalledOnce();
    expect(fixture.hooks.startIdlePeriod).toHaveBeenCalledOnce();
    expect(fixture.turns).toHaveLength(0);
  }));

  it('delivers work queued by the idle owner on a later host turn without self-waking', () => {
    const fixture = createFixture();
    const idleSteps = vi.fn();
    fixture.hooks.startIdlePeriod.mockImplementationOnce(() => {
      fixture.window.env.realm.queueGlobalTask(domManipulationTaskSource, { run: idleSteps });
    });
    fixture.loop.queueTask(domManipulationTaskSource, null, { run: () => {} });
    fixture.turns.shift()!();
    expect(idleSteps).not.toHaveBeenCalled();
    expect(fixture.turns).toHaveLength(1);
    fixture.turns.shift()!();
    expect(idleSteps).toHaveBeenCalledOnce();
    expect(fixture.hooks.startIdlePeriod).toHaveBeenCalledTimes(2);
    expect(fixture.turns).toHaveLength(0);
  });

  it('does not queue delivery when the Window has no idle callbacks', () => {
    const fixture = createFixture();
    fixture.restoreIdleStart();
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const loop = traversable.activeDocument!.env.responsibleEventLoop;
    expect(loop.runTaskTurn()).toBe(false);
    expect(loop.lastIdlePeriodStartTime.milliseconds).toBe(1000);
    expect(loop.hasRunnableTasks()).toBe(false);
    expect(fixture.hooks.startIdlePeriod).not.toHaveBeenCalled();
  });

  it.each([SandboxAgent, DedicatedWorkerAgent])('does not start Window idle periods for %s', (Agent) => {
    const fixture = createFixture();
    const loop = createManualEventLoop({ idleRendering: fixture.hooks });
    const agent = new Agent(loop);
    expect(loop.agent).toBe(agent);
    expect(loop.runTaskTurn()).toBe(false);
    expect(loop.lastIdlePeriodStartTime.milliseconds).toBe(0);
    expect(fixture.hooks.startIdlePeriod).not.toHaveBeenCalled();
  });
});

function createFixture() {
  let now = 1000;
  vi.spyOn(monotonicClock, 'unsafeCurrentTime').mockImplementation(() => new UnsafeMoment(monotonicClock, now));
  const deadlines: Map<WindowIdleCallbacks, () => Moment> = new Map();
  const hooks = {
    hasPendingRenders: vi.fn<WindowIdleRendering['hasPendingRenders']>(() => false),
    getRefreshRate: vi.fn(() => 60),
    startIdlePeriod: vi.fn<(callbacks: WindowIdleCallbacks, computeDeadline: () => Moment) => void>((callbacks, computeDeadline) => {
      deadlines.set(callbacks, computeDeadline);
    }),
  };
  const startIdlePeriod = vi.spyOn(WindowIdleCallbacks.prototype, 'startIdlePeriod')
    .mockImplementation(function(this: WindowIdleCallbacks, computeDeadline) {
      hooks.startIdlePeriod(this, computeDeadline);
    });
  const turns: (() => void)[] = [];
  const userAgent = createManualUserAgent({ idleRendering: hooks, requestTurn: (steps) => { turns.push(steps); } });
  userAgent.timerHost = { scheduleTimeout: () => ({ remove: () => true }) };
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const window = traversable.activeWindow!;
  return {
    window, traversable, userAgent, hooks, turns, deadlines,
    loop: window.env.responsibleEventLoop,
    setTime: (time: number) => { now = time; },
    restoreIdleStart: () => { startIdlePeriod.mockRestore(); },
    deadline: () => deadlines.get(window.idleCallbacks)!(),
  };
}

function createSameLoopWindow(source: WindowImpl): WindowImpl {
  const sourceEnv = source.env;
  const env = sourceEnv.userAgent.createWindowEnvironment({
    agent: sourceEnv.realm.agent, userAgent: sourceEnv.userAgent,
    creationURL: sourceEnv.creationURL, origin: sourceEnv.origin, parent: null,
    topLevelCreationURL: sourceEnv.creationURL, topLevelOrigin: sourceEnv.origin,
  });
  env.window.setAssociatedDocument(env.createDocument());
  return env.window;
}

function timers(window: WindowImpl) {
  return window.getWindowOrWorkerGlobalScopeMixin().timers;
}
