import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';

describe('shared stream Promise failures', () => {
  it('shares a borrowed write failure between write, ready, and closed', async () => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async () => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      const writer = new WritableStream({}, { highWaterMark: 0, size: () => -1 }).getWriter();
      const ready = writer.ready.catch((error: unknown) => error);
      const closed = writer.closed.catch((error: unknown) => error);
      const writing = other.WritableStreamDefaultWriter.prototype.write.call(writer, 'chunk');
      const error: unknown = await writing.catch((error: unknown) => error);
      const [readyError, closedError] = await Promise.all([ready, closed]);
      return {
        methodError: error instanceof other.RangeError,
        shared: error === readyError && error === closedError,
      };
    });
    expect(result).toEqual({ methodError: true, shared: true });
  });

  it('shares a borrowed byte-controller close failure with a pending read and closed', async () => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async () => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      let controller!: ReadableByteStreamController;
      const reader = new ReadableStream({
        type: 'bytes', start(value) { controller = value; },
      }).getReader({ mode: 'byob' });
      const closed = reader.closed.catch((error: unknown) => error);
      const reading = reader.read(new Uint16Array(1)).catch((error: unknown) => error);
      controller.enqueue(Uint8Array.of(1));
      let caught: unknown;
      try { other.ReadableByteStreamController.prototype.close.call(controller); }
      catch (error) { caught = error; }
      const [closedError, readError] = await Promise.all([closed, reading]);
      return {
        methodError: caught instanceof other.TypeError,
        shared: caught === closedError && caught === readError,
      };
    });
    expect(result).toEqual({ methodError: true, shared: true });
  });
});

function createBrowlet(): Browlet {
  const browlet = new Browlet({ route: () => '' });
  const foreign = new Browlet({ route: () => '' });
  Reflect.set(browlet.window, 'foreignStreamRealm', foreign.window);
  return browlet;
}
