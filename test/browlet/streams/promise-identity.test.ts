import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';

describe('Stream promise identity', () => {
  it('returns the same reader.closed promise before and after closing', async () => {
    const browlet = new Browlet({ route: () => '' });
    const result = await browlet.evaluate(async () => {
      let controller!: ReadableStreamDefaultController;
      const reader = new ReadableStream({
        start(value) { controller = value; },
      }).getReader();
      const closed = reader.closed;
      const beforeClose = reader.closed === closed;
      controller.close();
      await closed;
      return { beforeClose, afterClose: reader.closed === closed };
    });

    expect(result).toEqual({ beforeClose: true, afterClose: true });
  });

  it('retains writer promises until the stream replaces their stored state', async () => {
    const browlet = new Browlet({ route: () => '' });
    const result = await browlet.evaluate(async () => {
      const writer = new WritableStream<string>().getWriter();
      const closed = writer.closed;
      const initialReady = writer.ready;
      const beforeWrite = [writer.closed === closed, writer.ready === initialReady];
      const writing = writer.write('chunk');
      const backpressureReady = writer.ready;
      const whileWriting = [backpressureReady !== initialReady, writer.ready === backpressureReady];
      await writing;
      await backpressureReady;
      await writer.close();
      await closed;
      return {
        beforeWrite, whileWriting,
        afterClose: [writer.closed === closed, writer.ready === backpressureReady],
      };
    });

    expect(result).toEqual({
      beforeWrite: [true, true], whileWriting: [true, true], afterClose: [true, true],
    });
  });
});
