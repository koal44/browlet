import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

describe('byte-stream buffer ownership', () => {
  it('delivers owned chunks to a sink without changing their byte range', async () => {
    const window = createWindow();
    const source = Uint8Array.of(9, 1, 2, 9);
    const stream = new window.ReadableStream<Uint8Array>({
      type: 'bytes',
      start(controller) {
        controller.enqueue(source.subarray(1, 3));
        controller.close();
      },
    });
    const chunks: Uint8Array[] = [];
    const sink = new window.WritableStream<Uint8Array>({
      write(chunk) { chunks.push(chunk); },
    });

    await complete(window, stream.pipeTo(sink));

    expect(source.buffer.byteLength).toBe(0);
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    if (!chunk) throw new Error('Expected a byte chunk');
    expectOwnedBytes(window, chunk);
    expect(chunk.byteOffset).toBe(1);
    expect(Array.from(chunk)).toEqual([1, 2]);
  });

  it.each(['Uint16Array', 'DataView'] as const)(
    'preserves %s layout while transferring a foreign BYOB buffer', async (name) => {
      const window = createWindow();
      const suppliedViews: ArrayBufferView[] = [];
      const stream = new window.ReadableStream({
        type: 'bytes',
        pull(controller) {
          const request = controller.byobRequest;
          if (!request?.view) throw new Error('Expected a BYOB request');
          suppliedViews.push(request.view);
          const bytes = new Uint8Array(request.view.buffer, request.view.byteOffset, 2);
          bytes.set([1, 2]);
          if (name === 'DataView') request.respondWithNewView(bytes);
          else request.respond(2);
          controller.close();
        },
      });
      const buffer = new ArrayBuffer(8);
      const input = name === 'DataView'
        ? new DataView(buffer, 2, 4) : new Uint16Array(buffer, 2, 2);
      // The intrinsic view kind comes from internal slots, not this property.
      Object.defineProperty(input, 'constructor', { get() { throw new Error('constructor read'); } });
      const reader = stream.getReader({ mode: 'byob' });

      const result = await complete(window, reader.read(input));
      const suppliedToSource = suppliedViews[0];

      expect(buffer.byteLength).toBe(0);
      expect(result.done).toBe(false);
      expect(result.value).toBeInstanceOf(window[name]);
      if (!result.value || !suppliedToSource) throw new Error('Expected supplied and returned views');
      expectOwnedBytes(window, suppliedToSource);
      expect(suppliedToSource.buffer.byteLength).toBe(0);
      expect(result.value.buffer).toBeInstanceOf(window.ArrayBuffer);
      expect(result.value.byteOffset).toBe(2);
      expect(result.value.byteLength).toBe(2);
      expect(result.value.buffer.byteLength).toBe(8);
      expect(Array.from(new Uint8Array(result.value.buffer, 2, 2))).toEqual([1, 2]);
    },
  );

  it('allocates the producer-visible BYOB view for a default reader in the stream realm', async () => {
    const window = createWindow();
    const suppliedViews: ArrayBufferView[] = [];
    const stream = new window.ReadableStream({
      type: 'bytes', autoAllocateChunkSize: 8,
      pull(controller) {
        const request = controller.byobRequest;
        if (!request?.view) throw new Error('Expected auto-allocated storage');
        suppliedViews.push(request.view);
        new Uint8Array(request.view.buffer).set([3, 4]);
        request.respond(2);
        controller.close();
      },
    });

    const result = await complete(window, stream.getReader().read());
    const suppliedToSource = suppliedViews[0];

    if (!suppliedToSource || !result.value) throw new Error('Expected supplied and returned views');
    expectOwnedBytes(window, suppliedToSource);
    expectOwnedBytes(window, result.value);
    expect(Array.from(result.value)).toEqual([3, 4]);
  });

  it('tees bytes into independent owned chunks', async () => {
    const window = createWindow();
    const stream = new window.ReadableStream<Uint8Array>({
      type: 'bytes',
      start(controller) {
        controller.enqueue(Uint8Array.of(9, 1, 2, 9).subarray(1, 3));
        controller.close();
      },
    });
    const [first, second] = stream.tee();
    const firstRead = complete(window, first.getReader().read());
    const secondRead = complete(window, second.getReader().read());
    const [a, b] = await Promise.all([firstRead, secondRead]);

    if (!a.value || !b.value) throw new Error('Expected both tee chunks');
    expectOwnedBytes(window, a.value);
    expectOwnedBytes(window, b.value);
    expect(a.value.buffer).not.toBe(b.value.buffer);
    expect(Array.from(a.value)).toEqual([1, 2]);
    a.value[0] = 99;
    expect(Array.from(b.value)).toEqual([1, 2]);
  });
});

function createWindow(): Window & typeof globalThis {
  return new Browlet({ route: () => '' }).window as Window & typeof globalThis;
}

function complete<Result>(window: Window, promise: Promise<Result>): Promise<Result> {
  const result = observeBrowletPromise(window, promise);
  performTestMicrotaskCheckpoint(window);
  return result;
}

function expectOwnedBytes(window: Window & typeof globalThis, view: ArrayBufferView): void {
  expect(view).toBeInstanceOf(window.Uint8Array);
  expect(view.buffer).toBeInstanceOf(window.ArrayBuffer);
}
