import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

describe('Streams callback dictionary bindings', () => {
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
