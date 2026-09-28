import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

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

  it('shares a borrowed transform enqueue failure with both sides', async () => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async () => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      let controller!: TransformStreamDefaultController;
      const stream = new TransformStream({ start(value) { controller = value; } }, {}, { size: () => -1 });
      const reader = stream.readable.getReader();
      const writer = stream.writable.getWriter();
      const failures = Promise.all([reader.closed, writer.write('waiting'), writer.ready, writer.closed]
        .map((promise) => promise.catch((error: unknown) => error)));
      let caught: unknown;
      try { other.TransformStreamDefaultController.prototype.enqueue.call(controller, 'chunk'); }
      catch (error) { caught = error; }
      return { methodError: caught instanceof other.RangeError, shared: (await failures).every((error) => error === caught) };
    });
    expect(result).toEqual({ methodError: true, shared: true });
  });

  // SPEC_CLASH(stream-reader-release-errors): Test Web IDL's current-realm errors; Gecko/WebKit differ. See the Streams README.
  it.each(['default', 'byob'] as const)('shares pending %s read errors from a borrowed release', async (mode) => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async (mode) => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      let reader: ReadableStreamDefaultReader | ReadableStreamBYOBReader;
      let first: Promise<unknown>;
      let second: Promise<unknown>;
      let release: () => void;
      if (mode === 'byob') {
        const byob = new ReadableStream({ type: 'bytes' }).getReader({ mode: 'byob' });
        reader = byob;
        first = byob.read(new Uint8Array(1)).catch((error: unknown) => error);
        second = byob.read(new Uint8Array(1)).catch((error: unknown) => error);
        release = () => other.ReadableStreamBYOBReader.prototype.releaseLock.call(byob);
      } else {
        const ordinary = new ReadableStream().getReader();
        reader = ordinary;
        first = ordinary.read().catch((error: unknown) => error);
        second = ordinary.read().catch((error: unknown) => error);
        release = () => other.ReadableStreamDefaultReader.prototype.releaseLock.call(ordinary);
      }
      const previousClosed = reader.closed;
      const closed = previousClosed.catch((error: unknown) => error);
      release();
      const [firstError, secondError, closedError] = await Promise.all([first, second, closed]);
      return {
        methodErrors: [firstError, secondError, closedError].every((error) => error instanceof other.TypeError),
        sharedReadError: firstError === secondError,
        separateClosedError: closedError !== firstError,
        retainedClosed: reader.closed === previousClosed,
      };
    }, mode);
    expect(result).toEqual({ methodErrors: true, sharedReadError: true, separateClosedError: true, retainedClosed: true });
  });

  it.each(['default', 'byob'] as const)('replaces a settled %s closed Promise on borrowed release', async (mode) => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async (mode) => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      const reader = mode === 'byob'
        ? new ReadableStream({ type: 'bytes', start(controller) { controller.close(); } }).getReader({ mode: 'byob' })
        : new ReadableStream({ start(controller) { controller.close(); } }).getReader();
      const previousClosed = reader.closed;
      if (mode === 'byob') other.ReadableStreamBYOBReader.prototype.releaseLock.call(reader);
      else other.ReadableStreamDefaultReader.prototype.releaseLock.call(reader);
      const closed = reader.closed;
      const error: unknown = await closed.catch((error: unknown) => error);
      return {
        replaced: previousClosed !== closed, retained: reader.closed === closed,
        methodError: error instanceof other.TypeError,
      };
    }, mode);
    expect(result).toEqual({ replaced: true, retained: true, methodError: true });
  });

  it.each(['pending', 'writable', 'closed'] as const)('shares a borrowed writer release error when %s', async (state) => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async (state) => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      const writer = new WritableStream({}, { highWaterMark: state === 'pending' ? 0 : 1 }).getWriter();
      if (state === 'closed') await writer.close();
      const previousReady = writer.ready;
      const previousClosed = writer.closed;
      other.WritableStreamDefaultWriter.prototype.releaseLock.call(writer);
      const ready = writer.ready;
      const closed = writer.closed;
      const [readyError, closedError] = await Promise.all([ready, closed].map((promise) => promise.catch((error: unknown) => error)));
      return {
        readyReplaced: previousReady !== ready, closedReplaced: previousClosed !== closed,
        retained: writer.ready === ready && writer.closed === closed,
        methodError: readyError instanceof other.TypeError, shared: readyError === closedError,
      };
    }, state);
    expect(result).toEqual({
      readyReplaced: state !== 'pending', closedReplaced: state === 'closed',
      retained: true, methodError: true, shared: true,
    });
  });

  it('shares a borrowed transform termination error through the writable side', async () => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async () => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      let controller!: TransformStreamDefaultController;
      const stream = new TransformStream({ start(value) { controller = value; } });
      const reader = stream.readable.getReader();
      const writer = stream.writable.getWriter();
      const failures = Promise.all([writer.write('waiting'), writer.ready, writer.closed]
        .map((promise) => promise.catch((error: unknown) => error)));
      other.TransformStreamDefaultController.prototype.terminate.call(controller);
      const errors = await failures;
      return {
        methodError: errors[0] instanceof other.TypeError,
        shared: errors.every((error) => error === errors[0]), readableClosed: (await reader.read()).done,
      };
    });
    expect(result).toEqual({ methodError: true, shared: true, readableClosed: true });
  });

  // SPEC_CLASH(stream-pipe-through-error-realm): Test the method-realm cancellation error; Gecko uses the receiver realm.
  it('passes the borrowed pipeThrough error to source cancellation when the destination is closed', async () => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async () => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      const cancellation = Promise.withResolvers<unknown>();
      const source = new ReadableStream({ cancel: cancellation.resolve });
      const destination = new WritableStream();
      const writer = destination.getWriter();
      await writer.close();
      writer.releaseLock();
      const readable = new ReadableStream();
      const output = other.ReadableStream.prototype.pipeThrough.call(source, { readable, writable: destination });
      const error = await cancellation.promise;
      return { returnedReadable: output === readable, methodError: error instanceof other.TypeError };
    });
    expect(result).toEqual({ returnedReadable: true, methodError: true });
  });

  it('retains the invoking realm through a nested size callback', async () => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async () => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      const collect = (writer: WritableStreamDefaultWriter, writing: Promise<void>) =>
        Promise.all([writing, writer.ready, writer.closed].map((promise) => promise.catch((error: unknown) => error)));
      const inner = new WritableStream({}, { highWaterMark: 0, size: () => -1 }).getWriter();
      let innerErrors!: Promise<unknown[]>;
      const outer = new WritableStream({}, {
        highWaterMark: 0,
        size() {
          innerErrors = collect(inner, inner.write('inner'));
          return -1;
        },
      }).getWriter();
      const outerErrors = collect(outer, other.WritableStreamDefaultWriter.prototype.write.call(outer, 'outer'));
      const [first, second] = await Promise.all([innerErrors, outerErrors]);
      return {
        innerRealm: first[0] instanceof RangeError,
        outerRealm: second[0] instanceof other.RangeError,
        shared: first.every((error) => error === first[0]) && second.every((error) => error === second[0]),
      };
    });
    expect(result).toEqual({ innerRealm: true, outerRealm: true, shared: true });
  });

  it('retains the captured error through delayed writer startup', async () => {
    const browlet = createBrowlet();
    const result = await browlet.evaluate(async () => {
      const other = Reflect.get(globalThis, 'foreignStreamRealm') as typeof globalThis;
      const startup = Promise.withResolvers<void>();
      const writer = new WritableStream({ start: () => startup.promise }, { highWaterMark: 0, size: () => -1 }).getWriter();
      const ready = writer.ready;
      const closed = writer.closed;
      const RangeError = other.RangeError;
      Reflect.set(other, 'RangeError', function() { throw new Error('Replaced constructor called'); });
      let writing: Promise<void>;
      try { writing = other.WritableStreamDefaultWriter.prototype.write.call(writer, 'chunk'); }
      finally { Reflect.set(other, 'RangeError', RangeError); }
      const settled = { write: false, closed: false };
      const errors = Promise.all([
        writing.catch((error: unknown) => { settled.write = true; return error; }),
        ready.catch((error: unknown) => error),
        closed.catch((error: unknown) => { settled.closed = true; return error; }),
      ]);
      const readyError: unknown = await ready.catch((error: unknown) => error);
      const pending = !settled.write && !settled.closed;
      startup.resolve();
      const failures = await errors;
      return {
        pending,
        retained: ready === writer.ready && closed === writer.closed,
        methodError: readyError instanceof RangeError,
        shared: failures.every((error) => error === readyError),
      };
    });
    expect(result).toEqual({ pending: true, retained: true, methodError: true, shared: true });
  });
});

function createBrowlet(): Browlet {
  const browlet = new Browlet({ route: () => '' });
  Reflect.set(browlet.window, 'foreignStreamRealm', createSiblingWindow(browlet));
  return browlet;
}
