import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import * as scheduling from '../../../src/browlet/integration/scripting';

afterEach(() => { vi.restoreAllMocks(); });

describe('ReadableStream source reaction delivery', () => {
  it('imports a Node callback result before continuing in the stream\'s HTML queue', async () => {
    vi.spyOn(scheduling, 'requestNodeEventLoopTurn').mockImplementation(() => {});
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    const pending = Promise.withResolvers<void>();
    const results: unknown[] = [];
    browlet.expose('hostStart', () => pending.promise);
    browlet.expose('recordResult', (value: unknown) => { results.push(value); });
    realm.evaluate(`
      new ReadableStream({
        start: hostStart,
        pull(controller) { controller.enqueue('host chunk'); controller.close(); },
      }).getReader().read().then(value => recordResult(value));
    `, 'node-source-result.js');
    realm.agent.eventLoop.performMicrotaskCheckpoint();
    pending.resolve();
    // Complete the native backend turn; it must not drain the HTML queue.
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(results).toEqual([]);
    realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(results).toEqual([{ value: 'host chunk', done: false }]);
  });

  it('runs delayed start and pull through each stream\'s own HTML queue', () => {
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

  it.each(['start', 'pull'] as const)(
    'delivers a delayed %s rejection to the pending read in its own queue', (stage) => {
      const { first, second } = createFixtures();
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
  browlet.expose('recordCallback', (name: string, receiverMatches: boolean, controllerMatches: boolean) => {
    calls.push(name);
    callbackReceivers.push(receiverMatches);
    callbackControllers.push(controllerMatches);
  });
  browlet.expose('recordResult', (value: unknown) => { results.push(value); });
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
