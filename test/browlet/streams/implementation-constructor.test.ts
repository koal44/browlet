import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

describe('Streams callback dictionary bindings', () => {
  it('completes a read after a delayed source callback without manual checkpoints', async () => {
    const results = await runInPage(`
      const stream = new ReadableStream({
        async start(controller) {
          await new Promise(resolve => setTimeout(resolve, 0));
          controller.enqueue('ready');
          controller.close();
        },
      });
      const reader = stream.getReader();
      return [await reader.read(), await reader.read()];
    `);

    expect(results).toEqual([
      { value: 'ready', done: false },
      { value: undefined, done: true },
    ]);
  });

  it('delivers a delayed source rejection and permits subsequent reads', async () => {
    const results = await runInPage(`
      const failure = new Error('source failed');
      const stream = new ReadableStream({
        async start() {
          await new Promise(resolve => setTimeout(resolve, 0));
          throw failure;
        },
      });
      const caught = await stream.getReader().read().then(
        () => false, reason => reason === failure,
      );
      const next = new ReadableStream({
        start(controller) {
          controller.enqueue('next');
          controller.close();
        },
      });
      return [caught, await next.getReader().read()];
    `);

    expect(results).toEqual([true, { value: 'next', done: false }]);
  });

  it('captures source members once and preserves the source receiver', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const Promise_ = Reflect.get(window, 'Promise') as typeof Promise;
    const order: string[] = [];
    const receivers: unknown[] = [];
    const source = {
      get autoAllocateChunkSize() { order.push('size'); return undefined; },
      get cancel() {
        order.push('cancel');
        return function(this: unknown) { receivers.push(this); return Promise_.resolve(); };
      },
      get pull() { order.push('pull'); return undefined; },
      get start() {
        order.push('start');
        return function(this: unknown) { receivers.push(this); };
      },
      get type() { order.push('type'); return undefined; },
    };
    const Constructor = Reflect.get(window, 'ReadableStream') as typeof ReadableStream;
    const stream = new Constructor(source);
    const canceled = observeBrowletPromise(window, stream.cancel());
    performTestMicrotaskCheckpoint(window);
    await canceled;

    expect(order).toEqual(['size', 'cancel', 'pull', 'start', 'type']);
    expect(receivers).toEqual([source, source]);
  });

  it('captures sink members once and preserves the sink receiver', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const Promise_ = Reflect.get(window, 'Promise') as typeof Promise;
    const order: string[] = [];
    const receivers: unknown[] = [];
    const sink = {
      get abort() { order.push('abort'); return undefined; },
      get close() {
        order.push('close');
        return function(this: unknown) { receivers.push(this); return Promise_.resolve(); };
      },
      get start() {
        order.push('start');
        return function(this: unknown) { receivers.push(this); };
      },
      get type() { order.push('type'); return undefined; },
      get write() { order.push('write'); return undefined; },
    };
    const Constructor = Reflect.get(window, 'WritableStream') as typeof WritableStream;
    const stream = new Constructor(sink);
    const closed = observeBrowletPromise(window, stream.close());
    performTestMicrotaskCheckpoint(window);
    await closed;

    expect(order).toEqual(['abort', 'close', 'start', 'type', 'write']);
    expect(receivers).toEqual([sink, sink]);
  });
});

async function runInPage(source: string): Promise<unknown> {
  const completion = Promise.withResolvers<unknown>();
  const browlet = new Browlet({
    route: () => `<script>(async () => {${source}})().then(complete, fail);</script>`,
  });
  browlet.expose('complete', completion.resolve);
  browlet.expose('fail', completion.reject);
  await browlet.navigate('https://example.test/');
  return completion.promise;
}
