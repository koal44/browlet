import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import * as scheduling from '../../../src/browlet/integration/scripting';

afterEach(() => { vi.restoreAllMocks(); });

describe('ReadableStream source reaction delivery', () => {
  it('delivers a Node callback result through the stream\'s HTML task queue', async () => {
    const turns: (() => void)[] = [];
    vi.spyOn(scheduling, 'requestNodeEventLoopTurn').mockImplementation((turn) => { turns.push(turn); });
    const browlet = new Browlet({ route: () => '' });
    const pending = Promise.withResolvers<void>();
    const results: unknown[] = [];
    await browlet.exposeFunction('hostStart', () => pending.promise);
    const result = browlet.evaluate(() => {
      const hostStart = Reflect.get(globalThis, 'hostStart') as () => Promise<void>;
      return new ReadableStream<string>({
        start() { return hostStart(); },
        pull(controller) { controller.enqueue('host chunk'); controller.close(); },
      }).getReader().read();
    }).then((value) => { results.push(value); });
    turns.shift()!();
    pending.resolve();
    // Complete the native backend turn; it must not drain the HTML queue.
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(results).toEqual([]);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    await result;
    expect(results).toEqual([{ value: 'host chunk', done: false }]);
  });

  itPassesWith('explicitQueues')('runs delayed start and pull through each stream\'s own HTML queue', () => {
    const { first, second } = createFixtures();
    expect(first.calls).toEqual(['start']);
    expect(second.calls).toEqual(['start']);

    first.controls.resolveStart();
    second.controls.resolveStart();
    second.checkpoint();
    expect(first.calls).toEqual(['start']);
    expect(second.calls).toEqual(['start', 'pull']);
    first.checkpoint();
    expect(first.calls).toEqual(['start', 'pull']);
    expect(first.results).toEqual([]);
    expect(second.results).toEqual([]);

    first.controls.resolvePull();
    second.controls.resolvePull();
    first.checkpoint();
    expect(first.results).toEqual([{ value: 'chunk', done: false }]);
    expect(second.results).toEqual([]);
    second.checkpoint();
    expect(second.results).toEqual([{ value: 'chunk', done: false }]);

    for (const fixture of [first, second]) {
      expect(fixture.callbackReceivers).toEqual([true, true]);
      expect(fixture.callbackControllers).toEqual([true, true]);
      expect(Object.getPrototypeOf(fixture.results[0])).toBe(fixture.realm.intrinsics.objectPrototype);
    }
  });

  itPassesWith('explicitQueues').each(['start', 'pull'] as const)(
    'delivers a delayed %s rejection to the pending read in its own queue', async (stage) => {
      const { first, second } = createFixtures();
      // Finish attaching the source observers before triggering a later failure,
      // including on Node's ambient queue. Queue isolation is still checked below.
      await nextTurn();
      if (stage === 'pull') {
        first.controls.resolveStart();
        second.controls.resolveStart();
        first.checkpoint();
        second.checkpoint();
        expect(first.calls).toEqual(['start', 'pull']);
        expect(second.calls).toEqual(['start', 'pull']);
      }

      first.controls.reject(stage);
      second.controls.reject(stage);
      second.checkpoint();
      expect(first.results).toEqual([]);
      expect(second.results).toEqual([second.controls.failure]);
      first.checkpoint();
      expect(first.results).toEqual([first.controls.failure]);
      if (stage === 'start') {
        expect(first.calls).toEqual(['start']);
        expect(second.calls).toEqual(['start']);
      }
    },
  );
});

function createFixtures() {
  // Advance the two HTML queues explicitly, without intervening Node turns.
  vi.spyOn(scheduling, 'requestNodeEventLoopTurn').mockImplementation(() => {});
  return { first: createSource(), second: createSource() };
}

function createSource() {
  const browlet = new Browlet({ route: () => '' });
  const realm = getRelevantRealm(browlet.window);
  const calls: string[] = [];
  const callbackReceivers: boolean[] = [];
  const callbackControllers: boolean[] = [];
  const results: unknown[] = [];
  // These callbacks synchronously inspect internal queue and object identities.
  Reflect.set(realm.globalObject, 'recordCallback', (name: string, receiverMatches: boolean, controllerMatches: boolean) => {
    calls.push(name);
    callbackReceivers.push(receiverMatches);
    callbackControllers.push(controllerMatches);
  });
  Reflect.set(realm.globalObject, 'recordResult', (value: unknown) => { results.push(value); });
  const controls = realm.evaluate(`
    const start = Promise.withResolvers();
    const pull = Promise.withResolvers();
    const failure = new Error('source failed');
    const source = {
      start(controller) {
        recordCallback('start', this === source, controller instanceof ReadableStreamDefaultController);
        return start.promise;
      },
      pull(controller) {
        recordCallback('pull', this === source, controller instanceof ReadableStreamDefaultController);
        return pull.promise.then(() => {
          controller.enqueue('chunk');
          controller.close();
        });
      },
    };
    const reader = new ReadableStream(source).getReader();
    reader.closed.catch(() => {});
    reader.read().then(value => recordResult(value), reason => recordResult(reason));
    ({
      failure,
      resolveStart() { start.resolve(); },
      resolvePull() { pull.resolve(); },
      reject(stage) { (stage === 'start' ? start : pull).reject(failure); },
    });
  `, 'source-reactions.js') as SourceControls;
  return {
    realm, calls, callbackReceivers, callbackControllers, results, controls,
    checkpoint: () => realm.agent.eventLoop.performMicrotaskCheckpoint(),
  };
}

type SourceControls = {
  readonly failure: Error;
  resolveStart(): void;
  resolvePull(): void;
  reject(stage: 'start' | 'pull'): void;
};
