import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { UserAgent } from '../../../src/browlet/user-agent';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import { queueNodeTask } from '../../../src/browlet/integration/host/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { IdleDeadlineImpl, type IdleRequestCallback } from '../../../src/browlet/browsing/window/idle-callback';
import { domManipulationTaskSource, idleTaskSource } from '../../../src/browlet/scripting/tasks';
import { Moment, monotonicClock, UnsafeMoment } from '../../../src/browlet/timing/clock';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('requestIdleCallback bindings', () => {
  it('projects a timed-out deadline when the rendering prediction leaves no idle time', async () => {
    vi.spyOn(UserAgent.prototype, 'createWindowAgent').mockImplementation(() => new WindowAgent(createManualEventLoop({
      requestTurn: queueNodeTask,
      idleRendering: { hasPendingRenders: () => true, getRefreshRate: () => 60 },
    })));
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => new Promise((resolve) => {
      requestIdleCallback((deadline) => {
        resolve({
          timeout: deadline.didTimeout, remaining: deadline.timeRemaining(),
          prototype: Object.getPrototypeOf(deadline) === IdleDeadline.prototype,
        });
      }, { timeout: 1 });
    }))).toEqual({ timeout: true, remaining: 0, prototype: true });
  });

  it('delivers a realm-owned deadline asynchronously with the specified receiver', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => new Promise((resolve) => {
      let synchronous = true;
      const handle = requestIdleCallback(function(this: unknown, deadline) {
        'use strict';
        resolve({
          synchronous, handle, receiver: this === undefined,
          prototype: Object.getPrototypeOf(deadline) === IdleDeadline.prototype,
          timeout: deadline.didTimeout, remaining: deadline.timeRemaining(),
          tag: Object.prototype.toString.call(deadline),
        });
      });
      synchronous = false;
    }))).toMatchObject({
      synchronous: false, handle: 1, receiver: true,
      prototype: true, timeout: false, tag: '[object IdleDeadline]',
    });
  });

  it('cancels pending and runnable callbacks and preserves FIFO delivery', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => new Promise((resolve) => {
      const order: string[] = [];
      const pending = requestIdleCallback(() => { order.push('canceled pending'); });
      cancelIdleCallback(pending);
      requestIdleCallback(() => { order.push('first'); cancelIdleCallback(runnable); });
      const runnable = requestIdleCallback(() => { order.push('canceled runnable'); });
      requestIdleCallback(() => { order.push('last'); resolve(order); });
    }))).toEqual(['first', 'last']);
  });

  it('reports callback exceptions and continues the batch', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => new Promise((resolve) => {
      const errors: string[] = [];
      addEventListener('error', (event) => { errors.push((event.error as Error).message); event.preventDefault(); }, { once: true });
      requestIdleCallback(() => { throw new Error('idle callback failed'); });
      requestIdleCallback(() => { resolve(errors); });
    }))).toEqual(['idle callback failed']);
  });

  it('keeps reposted work out of the current batch and checkpoints between callbacks', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => new Promise((resolve) => {
      const order: string[] = [];
      requestIdleCallback(() => {
        order.push('first');
        queueMicrotask(() => { order.push('microtask'); });
        requestIdleCallback(() => { order.push('reposted'); resolve(order); });
      });
      requestIdleCallback(() => { order.push('second'); });
    }))).toEqual(['first', 'microtask', 'second', 'reposted']);
  });

  it('performs Web IDL validation, dictionary conversion, and brand checks', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => new Promise((resolve) => {
      const failures: boolean[] = [];
      for (const operation of [
        () => { Reflect.apply(requestIdleCallback, window, []); },
        () => { Reflect.apply(requestIdleCallback, window, [null]); },
        () => Reflect.apply(requestIdleCallback, {}, [() => {}]),
        () => Reflect.apply(cancelIdleCallback, {}, [1]),
        () => Reflect.construct(IdleDeadline, []),
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately exercise the Web IDL brand check.
        () => Reflect.apply(IdleDeadline.prototype.timeRemaining, {}, []),
      ]) {
        try { operation(); failures.push(false); }
        catch (error) { failures.push(error instanceof TypeError); }
      }
      let converted = 0;
      requestIdleCallback((deadline) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately exercise the Web IDL brand check.
        const getter = Object.getOwnPropertyDescriptor(IdleDeadline.prototype, 'didTimeout')!.get!;
        try { Reflect.apply(getter, {}, []); failures.push(false); }
        catch (error) { failures.push(error instanceof TypeError); }
        resolve({ failures, converted, timeout: deadline.didTimeout });
      }, { get timeout() { converted++; return 0; } });
    }))).toEqual({ failures: Array(7).fill(true), converted: 1, timeout: false });
  });
});

describe('idle callback scheduling', () => {
  it('runs nothing synchronously and does not keep scheduling an empty Window', () => {
    const fixture = createFixture();
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(callback, {});
    expect(callback).not.toHaveBeenCalled();
    fixture.flush();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].didTimeout).toBe(false);
    expect(fixture.turns).toHaveLength(0);
    expect(fixture.wakeups.size).toBe(0);
  });

  it('keeps reposted callbacks pending until the preceding period ends', () => {
    const fixture = createFixture();
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(() => { fixture.window.requestIdleCallback(callback, {}); }, {});
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
    expect(fixture.wakeups.size).toBe(1);
    fixture.advance(49);
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
    fixture.advance(1);
    fixture.flush();
    expect(callback).toHaveBeenCalledOnce();
    expect(fixture.wakeups.size).toBe(0);
  });

  it('puts old runnable callbacks before registrations made during a consumed period', () => {
    const fixture = createFixture();
    const order: string[] = [];
    fixture.window.requestIdleCallback(() => {
      order.push('first');
      fixture.window.requestIdleCallback(() => { order.push('new'); }, {});
      fixture.advance(51);
    }, {});
    fixture.window.requestIdleCallback(() => { order.push('old'); }, {});
    fixture.flush();
    expect(order).toEqual(['first', 'old', 'new']);
  });

  it('yields to ordinary runnable work and resumes at the next period', () => {
    const fixture = createFixture();
    const order: string[] = [];
    fixture.window.requestIdleCallback(() => {
      order.push('first');
      fixture.loop.queueTask(domManipulationTaskSource, null, () => { order.push('ordinary'); });
    }, {});
    fixture.window.requestIdleCallback(() => { order.push('second'); }, {});
    fixture.flush();
    expect(order).toEqual(['first', 'ordinary']);
    fixture.advance(50);
    fixture.flush();
    expect(order).toEqual(['first', 'ordinary', 'second']);
  });

  it('delivers timeout work even when there is no available idle budget', () => {
    const fixture = createFixture(false);
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(callback, { timeout: 10 });
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
    fixture.advance(10);
    expect(callback).not.toHaveBeenCalled();
    expect(fixture.loop.getTaskQueue(idleTaskSource).size).toBe(1);
    fixture.flush();
    expect(callback).toHaveBeenCalledOnce();
    const deadline = callback.mock.calls[0]![0];
    expect(deadline.didTimeout).toBe(true);
    expect(deadline.timeRemaining()).toBe(0);
  });

  it.each(['idle', 'timeout'])('lets the %s winner cancel the other delivery', (winner) => {
    const fixture = createFixture();
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(callback, { timeout: 10 });
    if (winner === 'idle') fixture.flush();
    fixture.advance(10);
    fixture.flush();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].didTimeout).toBe(winner === 'timeout');
    expect(fixture.wakeups.size).toBe(0);
  });

  it('cancels a timeout after its delivery task was queued', () => {
    const fixture = createFixture(false);
    const callback = vi.fn<IdleRequestCallback>();
    const handle = fixture.window.requestIdleCallback(callback, { timeout: 5 });
    fixture.advance(5);
    fixture.window.cancelIdleCallback(handle);
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not treat zero or absent timeouts as timeout requests', () => {
    const fixture = createFixture(false);
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(callback, {});
    fixture.window.requestIdleCallback(callback, { timeout: 0 });
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
    expect(fixture.wakeups.size).toBe(0);
    expect(fixture.turns).toHaveLength(0);
  });

  it('orders timeout tasks by absolute expiry even when the host fires them backwards', () => {
    const fixture = createFixture(false);
    const order: string[] = [];
    fixture.window.requestIdleCallback(() => { order.push('late'); }, { timeout: 30 });
    fixture.window.requestIdleCallback(() => { order.push('first'); }, { timeout: 10 });
    fixture.window.requestIdleCallback(() => { order.push('second'); }, { timeout: 10 });
    fixture.advance(30, true);
    fixture.flush();
    expect(order).toEqual(['first', 'second', 'late']);
  });

  it('rechecks an early host timer without delivering before expiry', () => {
    const fixture = createFixture(false);
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(callback, { timeout: 100 });
    const wakeup = [...fixture.wakeups][0]!;
    fixture.wakeups.delete(wakeup);
    wakeup.steps();
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
    fixture.advance(100);
    fixture.flush();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('retains inactive callbacks and wakes them when the Document becomes active', () => {
    const fixture = createFixture();
    const entry = fixture.traversable.activeSessionHistoryEntry;
    fixture.traversable.activeSessionHistoryEntry = fixture.window.env.createSessionHistoryEntry(entry.url, new DocumentState());
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(callback, {});
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
    expect(fixture.turns).toHaveLength(0);
    fixture.traversable.activeSessionHistoryEntry = entry;
    fixture.flush();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('counts elapsed timeout time while inactive but gates its delivery task', () => {
    const fixture = createFixture();
    const entry = fixture.traversable.activeSessionHistoryEntry;
    fixture.traversable.activeSessionHistoryEntry = fixture.window.env.createSessionHistoryEntry(entry.url, new DocumentState());
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(callback, { timeout: 5 });
    fixture.advance(10);
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
    fixture.traversable.activeSessionHistoryEntry = entry;
    fixture.flush();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].didTimeout).toBe(true);
  });

  it('releases delayed and queued callbacks during destruction', () => runInHostTask(() => {
    const fixture = createFixture();
    const callback = vi.fn<IdleRequestCallback>();
    fixture.window.requestIdleCallback(callback, { timeout: 10 });
    fixture.loop.queueTask(domManipulationTaskSource, fixture.window.document, () => { fixture.window.document.destroy(); });
    fixture.flush();
    fixture.advance(100);
    fixture.flush();
    expect(callback).not.toHaveBeenCalled();
    expect(fixture.wakeups.size).toBe(0);
  }));

  it.each([false, true])('coarsens both clock readings for isolation=%s and clamps expired budgets', (isolated) => {
    const fixture = createFixture();
    vi.spyOn(fixture.window.env, 'crossOriginIsolatedCapability', 'get').mockReturnValue(isolated);
    fixture.advance(0.123);
    const end = new UnsafeMoment(monotonicClock, 1050.129).coarsen(isolated);
    const deadline = new IdleDeadlineImpl(() => end, false, fixture.window.env);
    const now = new UnsafeMoment(monotonicClock, 1000.123).coarsen(isolated);
    expect(deadline.timeRemaining()).toBe(end.milliseconds - now.milliseconds);
    fixture.advance(100);
    expect(deadline.timeRemaining()).toBe(0);
  });
});

function createFixture(idleBudget = true) {
  let now = 1000;
  vi.spyOn(monotonicClock, 'unsafeCurrentTime').mockImplementation(() => new UnsafeMoment(monotonicClock, now));
  const turns: (() => void)[] = [];
  type WakeUp = {
    at: number;
    steps: () => void;
  };
  const wakeups = new Set<WakeUp>();
  const userAgent = createManualUserAgent({
    requestTurn: (steps) => { turns.push(steps); },
    idleRendering: { hasPendingRenders: () => !idleBudget, getRefreshRate: () => 60 },
  });
  userAgent.timerHost = {
    scheduleTimeout(milliseconds, steps) {
      const wakeup = { at: now + milliseconds, steps };
      wakeups.add(wakeup);
      return { remove: () => wakeups.delete(wakeup) };
    },
  };
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const window = traversable.activeWindow!;
  const loop = window.env.responsibleEventLoop;
  // A controlled origin keeps active HTML timer estimates in the same domain.
  vi.spyOn(window.env, 'timeOrigin', 'get').mockReturnValue(new Moment(monotonicClock, 1000));
  return {
    window, loop, traversable, turns, wakeups,
    flush() {
      let count = 0;
      while (turns.length !== 0) {
        if (++count > 100) throw new Error('Idle delivery kept waking itself');
        turns.shift()!();
      }
    },
    advance(milliseconds: number, reverse = false) {
      now += milliseconds;
      const due = [...wakeups].filter((wakeup) => wakeup.at <= now);
      if (reverse) due.reverse();
      for (const wakeup of due) {
        if (!wakeups.delete(wakeup)) continue;
        wakeup.steps();
      }
    },
  };
}
