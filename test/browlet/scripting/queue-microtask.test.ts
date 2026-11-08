import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import type { Task } from '../../../src/browlet/scripting/event-loop';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';
import { runInHostTask } from '../../support/tasks';

describe('HTML §8.7: queueMicrotask()', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it('invokes with no arguments or receiver and ignores the callback result', async () => {
    expect(await prepared().evaluate(() => {
      'use strict';
      return new Promise((resolve) => {
        const order: string[] = [];
        let received: { noReceiver: boolean; argumentCount: number; } | undefined;
        let resultReads = 0;
        const result = queueMicrotask(function(this: unknown, ...args: unknown[]) {
          order.push('callback');
          received = { noReceiver: this === undefined, argumentCount: args.length };
          return { get then() { resultReads++; throw new Error('Callback result was inspected'); } };
        });
        order.push('synchronous');
        queueMicrotask(() => { resolve({ order, received, resultReads, returnedUndefined: result === undefined }); });
      });
    })).toEqual({
      order: ['synchronous', 'callback'],
      received: { noReceiver: true, argumentCount: 0 },
      resultReads: 0,
      returnedUndefined: true,
    });
  });

  it('rejects missing or noncallable callbacks without coercing them', () => {
    const { window } = prepared();
    const realm = getRelevantRealm(window);
    let conversions = 0;
    const object = { toString() { conversions++; return 'callback'; } };
    for (const args of [[], [undefined], [null], [object], ['callback'], [1], [Symbol('callback')]]) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply supplies the receiver while testing invalid arguments
      expect(() => { Reflect.apply(window.queueMicrotask, window, args); }).toThrow(realm.TypeError);
    }
    expect(conversions).toBe(0);
  });
});

describe('queueMicrotask Document association', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const userAgent = createManualUserAgent();
    const traversable = TopLevelTraversable.create(userAgent, null, '');
    const realm = traversable.activeWindow!.env.realm;
    return { traversable, realm, document: traversable.activeDocument!, loop: realm.agent.eventLoop };
  });

  it('retains the Window Document for a microtask that could become an ordinary task', () => runInHostTask(() => {
    const { traversable, realm, document, loop } = prepared();
    const observed: (Task | null)[] = [];
    realm.windowProxy.platform.queueMicrotask(() => { observed.push(loop.currentlyRunningTask); });
    loop.performMicrotaskCheckpoint();

    expect(observed).toHaveLength(1);
    const task = observed[0];
    expect(task?.document === document).toBe(true);
    expect(task?.source.name).toBe('microtask');
    expect(task?.isRunnable).toBe(true);
    expect(loop.currentlyRunningTask).toBeNull();

    // The checkpoint ignores Document activity. If a microtask spins, its
    // ordinary-task continuation must instead retain this activity gate.
    traversable.activeSessionHistoryEntry = document.env.createSessionHistoryEntry(
      traversable.activeSessionHistoryEntry.url, new DocumentState(),
    );
    expect(task?.isRunnable).toBe(false);
  }));
});
