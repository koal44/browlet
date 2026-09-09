import { describe, expect, it } from 'vitest';
import { ReadableStreamImpl } from '../../../src/streams/readable-stream';
import { createWritableStream } from './implementation-fixture';

describe('Streams implementation constructors', () => {
  it('captures source members once and preserves the source receiver', async () => {
    const order: string[] = [];
    const receivers: unknown[] = [];
    const source = {
      get autoAllocateChunkSize() { order.push('size'); return undefined; },
      get cancel() {
        order.push('cancel');
        return function(this: unknown) { receivers.push(this); return Promise.resolve(); };
      },
      get pull() { order.push('pull'); return undefined; },
      get start() {
        order.push('start');
        return function(this: unknown) { receivers.push(this); };
      },
      get type() { order.push('type'); return undefined; },
    };
    const stream = new ReadableStreamImpl(source);
    await stream.cancel();

    expect(order).toEqual(['size', 'cancel', 'pull', 'start', 'type']);
    expect(receivers).toEqual([source, source]);
  });

  it('captures sink members once and preserves the sink receiver', async () => {
    const order: string[] = [];
    const receivers: unknown[] = [];
    const sink = {
      get abort() { order.push('abort'); return undefined; },
      get close() {
        order.push('close');
        return function(this: unknown) { receivers.push(this); return Promise.resolve(); };
      },
      get start() {
        order.push('start');
        return function(this: unknown) { receivers.push(this); };
      },
      get type() { order.push('type'); return undefined; },
      get write() { order.push('write'); return undefined; },
    };
    const stream = createWritableStream(sink);
    await stream.close();

    expect(order).toEqual(['abort', 'close', 'start', 'type', 'write']);
    expect(receivers).toEqual([sink, sink]);
  });
});
