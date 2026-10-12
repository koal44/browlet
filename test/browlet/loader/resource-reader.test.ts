import { describe, expect, it, vi } from 'vitest';
import { type InternalPromise } from '../../../src/infra/promises';
import { utf8Encode } from '../../../src/encoding/codecs/utf-8';
import { FetchBody } from '../../../src/fetch/body';
import { FetchResponse } from '../../../src/fetch/response';
import { ReadableStreamImpl } from '../../../src/streams/readable-stream';
import { UserAgent } from '../../../src/browlet/user-agent';
import { ResourceReader } from '../../../src/browlet/loader/resource-reader';

describe('ResourceReader', () => {
  it('returns a supplied HTML or XML type without waiting for body bytes', async () => {
    for (const [mime, type, subtype] of [
      ['text/html', 'text', 'html'], ['application/xhtml+xml', 'application', 'xhtml+xml'],
    ] as const) {
      const { response, stream, userAgent } = createResource();
      const clock = controlSniffingClock(userAgent);
      response.headerList.append('Content-Type', mime);
      const reader = new ResourceReader(response, userAgent);
      try {
        expect(await observe(reader.determineMIMEType())).toMatchObject({ type, subtype });
        expect(stream.locked).toBe(false);
        expect(clock.timers).toHaveLength(0);
      } finally { await observe(reader.cancel()); }
    }
  });

  it('sniffs a fragmented prefix once and replays every chunk, including the excess', async () => {
    const { reader, stream } = createResource();
    const first = utf8Encode('<!DOC');
    const second = utf8Encode(`TYPE html><p>${'x'.repeat(64 * 1024)}</p>`);
    stream.enqueueChunk(new Uint8Array());
    stream.enqueueChunk(first);
    stream.enqueueChunk(second);
    stream.close();

    const mimeType = reader.determineMIMEType();
    expect(() => reader.determineMIMEType()).toThrow('MIME type determination is already in progress');
    const determined = await observe(mimeType);
    expect(determined).toMatchObject({ type: 'text', subtype: 'html' });
    expect(await observe(reader.determineMIMEType())).toBe(determined);
    expect(await observe(reader.read())).toEqual(first);
    expect(await observe(reader.read())).toEqual(second);
    expect(await observe(reader.read())).toBeNull();
    expect(stream.locked).toBe(false);
  });

  it('requires a determined type before consuming the buffered body', async () => {
    const { reader, stream, response } = createResource();
    const reads = vi.spyOn(response.body!, 'readChunk');
    expect(() => reader.read()).toThrow('Determine the MIME type before consuming the resource body');
    expect(reads).not.toHaveBeenCalled();
    const mimeType = observe(reader.determineMIMEType());
    expect(() => reader.read()).toThrow('Determine the MIME type before consuming the resource body');
    stream.enqueueChunk(Uint8Array.of(1, 2));
    await expect.poll(() => reads.mock.calls.length).toBe(2);
    expect(() => reader.read()).toThrow('Determine the MIME type before consuming the resource body');
    stream.enqueueChunk(Uint8Array.of(3));
    stream.close();

    expect(await mimeType).toMatchObject({ type: 'application', subtype: 'octet-stream' });
    expect(await observe(reader.read())).toEqual(Uint8Array.of(1, 2));
    expect(await observe(reader.read())).toEqual(Uint8Array.of(3));
    expect(await observe(reader.read())).toBeNull();
  });

  it('stops collecting at the header limit and leaves subsequent input unread', async () => {
    const { reader, stream, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const prefix = new Uint8Array(1445).fill(7);
    const next = Uint8Array.of(1);
    stream.enqueueChunk(prefix);
    stream.enqueueChunk(next);
    stream.close();

    expect(await observe(reader.determineMIMEType())).toMatchObject({ type: 'application', subtype: 'octet-stream' });
    expect(clock.timers[0]!.remove).toHaveBeenCalledOnce();
    const replay = await observe(reader.read());
    expect(replay).toEqual(prefix);
    next[0] = 2;
    expect(await observe(reader.read())).toEqual(Uint8Array.of(2));
    expect(await observe(reader.read())).toBeNull();
  });

  it('finishes a short prefix at EOF and preserves binary data', async () => {
    const { reader, stream, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const getReader = vi.spyOn(stream, 'getDefaultReader');
    stream.enqueueChunk(Uint8Array.of(0));
    stream.close();
    expect(await observe(reader.determineMIMEType())).toMatchObject({ type: 'application', subtype: 'octet-stream' });
    expect(clock.timers[0]!.remove).toHaveBeenCalledOnce();
    expect(await observe(reader.read())).toEqual(Uint8Array.of(0));
    expect(await observe(reader.read())).toBeNull();
    expect(await observe(reader.read())).toBeNull();
    expect(getReader).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it.each([1444, 1445])('limits MIME inspection to 1445 bytes (binary byte at index %i)', async (index) => {
    for (const fragmented of [false, true]) {
      const { reader, stream } = createResource();
      const bytes = new Uint8Array(2000).fill(32);
      bytes[index] = 0;
      const chunks = fragmented ? [bytes.subarray(0, 5), bytes.subarray(5)] : [bytes];
      for (const chunk of chunks) stream.enqueueChunk(chunk);
      stream.close();

      expect(await observe(reader.determineMIMEType())).toMatchObject(index === 1444
        ? { type: 'application', subtype: 'octet-stream' }
        : { type: 'text', subtype: 'plain' });
      for (const chunk of chunks) expect(await observe(reader.read())).toEqual(chunk);
      expect(await observe(reader.read())).toBeNull();
    }
  });

  it('waits for consumer demand before reading the next chunk', async () => {
    const { reader, stream, response } = createResource();
    response.headerList.append('Content-Type', 'text/html');
    await observe(reader.determineMIMEType());
    const second = Uint8Array.of(2);
    stream.enqueueChunk(new Uint8Array());
    stream.enqueueChunk(Uint8Array.of(1));
    stream.enqueueChunk(new Uint8Array());
    stream.enqueueChunk(second);
    stream.close();
    expect(await observe(reader.read())).toEqual(Uint8Array.of(1));
    second[0] = 3;
    expect(await observe(reader.read())).toEqual(Uint8Array.of(3));
    expect(await observe(reader.read())).toBeNull();
  });

  it('requires sequential body reads after MIME determination', async () => {
    const { reader, stream, response } = createResource();
    response.headerList.append('Content-Type', 'text/html');
    await observe(reader.determineMIMEType());
    const body = observe(reader.read());
    expect(() => reader.read()).toThrow('Resource reads must be sequential');
    stream.enqueueChunk(Uint8Array.of(1));
    stream.close();
    expect(await body).toEqual(Uint8Array.of(1));
    expect(await observe(reader.read())).toBeNull();
  });

  it.each(['queued', 'delivered'] as const)('discards a %s Fetch chunk canceled before consumer delivery', async (stage) => {
    const { reader, stream, response, userAgent } = createResource();
    response.headerList.append('Content-Type', 'text/html');
    await observe(reader.determineMIMEType());
    const tasks: (() => void)[] = [];
    vi.spyOn(userAgent.sandbox.exec, 'queueGlobalFetchTask').mockImplementation((_global, steps) => {
      tasks.push(steps);
    });
    stream.enqueueChunk(Uint8Array.of(1));
    const result = observe(reader.read());
    const reason = new Error('navigation canceled before delivery');
    const assertion = expect(result).rejects.toBe(reason);
    await expect.poll(() => tasks.length).toBe(1);
    if (stage === 'delivered') tasks.shift()!();
    await observe(reader.cancel(reason));
    await assertion;
    if (stage === 'queued') expect(() => tasks.shift()!()).not.toThrow();
    expect(stream.locked).toBe(false);
    await expect(observe(reader.read())).rejects.toBe(reason);
  });

  it('ends sniffing at the deadline without losing the pending read', async () => {
    const { reader, stream, response, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const reads = vi.spyOn(response.body!, 'readChunk');
    stream.enqueueChunk(utf8Encode('<html>'));
    const mimeType = observe(reader.determineMIMEType());
    await expect.poll(() => reads.mock.calls.length).toBe(2);
    clock.now = 600;
    clock.expire();
    expect(await mimeType).toMatchObject({ type: 'text', subtype: 'html' });
    expect(clock.timers[0]!.remove).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(true);

    expect(await observe(reader.read())).toEqual(utf8Encode('<html>'));
    expect(reads).toHaveBeenCalledTimes(2);
    const pending = observe(reader.read());
    stream.enqueueChunk(utf8Encode('<p>after the deadline</p>'));
    stream.close();
    expect(await pending).toEqual(utf8Encode('<p>after the deadline</p>'));
    expect(await observe(reader.read())).toBeNull();
    expect(stream.locked).toBe(false);
  });

  it('retains a read completed after the deadline until the consumer asks for it', async () => {
    const { reader, stream, response, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const reads = vi.spyOn(response.body!, 'readChunk');
    const tasks: (() => void)[] = [];
    vi.spyOn(userAgent.sandbox.exec, 'queueGlobalFetchTask').mockImplementation((_global, steps) => {
      tasks.push(steps);
    });
    const mimeType = observe(reader.determineMIMEType());
    await expect.poll(() => reads.mock.calls.length).toBe(1);
    clock.now = 600;
    clock.expire();
    expect(await mimeType).toMatchObject({ type: 'text', subtype: 'plain' });
    stream.enqueueChunk(Uint8Array.of(0));
    await expect.poll(() => tasks.length).toBe(1);
    tasks.shift()!();

    expect(await observe(reader.read())).toEqual(Uint8Array.of(0));
    expect(reads).toHaveBeenCalledOnce();
    expect(await observe(reader.determineMIMEType())).toMatchObject({ type: 'text', subtype: 'plain' });
    await observe(reader.cancel());
  });

  it('resolves an empty sniffing prefix when the source stays silent until the deadline', async () => {
    const { reader, stream, response, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const reads = vi.spyOn(response.body!, 'readChunk');
    const mimeType = observe(reader.determineMIMEType());
    await expect.poll(() => reads.mock.calls.length).toBe(1);
    clock.now = 600;
    clock.expire();
    expect(await mimeType).toMatchObject({ type: 'text', subtype: 'plain' });

    const body = observe(reader.read());
    stream.enqueueChunk(utf8Encode('<html>'));
    stream.close();
    expect(await body).toEqual(utf8Encode('<html>'));
    expect(reads).toHaveBeenCalledOnce();
    expect(await observe(reader.read())).toBeNull();
    expect(await observe(reader.determineMIMEType())).toMatchObject({ type: 'text', subtype: 'plain' });
  });

  it('waits out the remaining deadline when the timer host wakes early', async () => {
    const { reader, stream, response, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const reads = vi.spyOn(response.body!, 'readChunk');
    stream.enqueueChunk(utf8Encode('text'));
    const mimeType = observe(reader.determineMIMEType());
    const determined = vi.fn();
    void mimeType.then(determined);
    await expect.poll(() => reads.mock.calls.length).toBe(2);
    clock.now = 300;
    clock.expire();
    expect(clock.timers[1]!.delay).toBe(300);
    expect(determined).not.toHaveBeenCalled();
    stream.enqueueChunk(Uint8Array.of(0));
    await expect.poll(() => reads.mock.calls.length).toBe(3);
    clock.now = 600;
    clock.expire();
    expect(await mimeType).toMatchObject({ type: 'application', subtype: 'octet-stream' });
    expect(clock.timers[1]!.remove).toHaveBeenCalledOnce();
    await observe(reader.cancel());
  });

  it('keeps a chunk delivered after the deadline out of the header even if the timer is late', async () => {
    const { reader, stream, response, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const reads = vi.spyOn(response.body!, 'readChunk');
    stream.enqueueChunk(utf8Encode('text'));
    const mimeType = observe(reader.determineMIMEType());
    await expect.poll(() => reads.mock.calls.length).toBe(2);
    clock.now = 600;
    stream.enqueueChunk(Uint8Array.of(0));
    stream.close();

    expect(await mimeType).toMatchObject({ type: 'text', subtype: 'plain' });
    expect(await observe(reader.read())).toEqual(utf8Encode('text'));
    expect(await observe(reader.read())).toEqual(Uint8Array.of(0));
    expect(await observe(reader.read())).toBeNull();
  });

  it.each(['EOF', 'error'] as const)('delivers the retained prefix before %s arriving after the deadline', async (end) => {
    const { reader, stream, response, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const reads = vi.spyOn(response.body!, 'readChunk');
    stream.enqueueChunk(Uint8Array.of(1));
    const mimeType = observe(reader.determineMIMEType());
    await expect.poll(() => reads.mock.calls.length).toBe(2);
    clock.now = 600;
    clock.expire();
    expect(await mimeType).toMatchObject({ type: 'application', subtype: 'octet-stream' });
    if (end === 'EOF') stream.close();
    else stream.error(undefined);
    await expect.poll(() => stream.locked).toBe(false);

    expect(await observe(reader.read())).toEqual(Uint8Array.of(1));
    if (end === 'EOF') expect(await observe(reader.read())).toBeNull();
    else await expect(observe(reader.read())).rejects.toBeUndefined();
  });

  it('uses the last raw HTTP type for Apache compatibility sniffing', async () => {
    const { response, stream, userAgent } = createResource();
    response.headerList.append('Content-Type', 'text/html');
    response.headerList.append('cOnTeNt-TyPe', 'text/plain; charset=UTF-8');
    const reader = new ResourceReader(response, userAgent);
    stream.enqueueChunk(Uint8Array.of(0));
    stream.close();
    expect(await observe(reader.determineMIMEType())).toMatchObject({ type: 'application', subtype: 'octet-stream' });
  });

  it('does not apply the HTTP Apache workaround to non-HTTP metadata', async () => {
    const { response, stream, userAgent } = createResource();
    response.urlList = [userAgent.parseURL('data:text/plain,hello').url!];
    response.headerList.append('Content-Type', 'text/plain');
    const reader = new ResourceReader(response, userAgent);
    stream.enqueueChunk(Uint8Array.of(0));
    stream.close();
    expect(await observe(reader.determineMIMEType())).toMatchObject({ type: 'text', subtype: 'plain' });
  });

  it('uses internal response metadata and honors nosniff', async () => {
    const { response, stream, userAgent } = createResource();
    response.headerList.append('X-Content-Type-Options', 'nosniff');
    const reader = new ResourceReader(response.filter('opaque'), userAgent);
    stream.enqueueChunk(utf8Encode('<html>'));
    stream.close();
    expect(reader.response).toBe(response);
    expect(await observe(reader.determineMIMEType())).toMatchObject({ type: 'text', subtype: 'plain' });
    expect(await observe(reader.read())).toEqual(utf8Encode('<html>'));
  });

  it.each(['sniffing', 'body'] as const)('retains a source failure after %s', async (kind) => {
    const { reader, stream, response } = createResource();
    const getReader = vi.spyOn(stream, 'getDefaultReader');
    const failure = new Error('connection lost');
    if (kind === 'body') {
      response.headerList.append('Content-Type', 'text/html');
      await observe(reader.determineMIMEType());
    }
    const result = kind === 'sniffing' ? observe(reader.determineMIMEType()) : observe(reader.read());
    const assertion = expect(result).rejects.toBe(failure);
    await expect.poll(() => stream.locked).toBe(true);
    stream.error(failure);
    await assertion;
    if (kind === 'sniffing') {
      await expect(observe(reader.determineMIMEType())).rejects.toBe(failure);
      expect(() => reader.read()).toThrow('Determine the MIME type before consuming the resource body');
    } else {
      await expect(observe(reader.read())).rejects.toBe(failure);
    }
    expect(getReader).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('cancels pending sniffing without allowing body consumption', async () => {
    const { reader, stream, cancelled, userAgent } = createResource();
    const clock = controlSniffingClock(userAgent);
    const reason = new Error('navigation canceled');
    const result = observe(reader.determineMIMEType());
    const assertion = expect(result).rejects.toBe(reason);
    await expect.poll(() => stream.locked).toBe(true);
    await observe(reader.cancel(reason));
    await assertion;
    expect(clock.timers[0]!.remove).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledWith(reason);
    expect(stream.locked).toBe(false);
    await expect(observe(reader.determineMIMEType())).rejects.toBe(reason);
    expect(() => reader.read()).toThrow('Determine the MIME type before consuming the resource body');
  });

  it.each([new Error('connection lost during inspection'), undefined])(
    'rejects type determination when a prefix is followed by %s', async (failure) => {
      const { reader, stream, response, userAgent } = createResource();
      const clock = controlSniffingClock(userAgent);
      const reads = vi.spyOn(response.body!, 'readChunk');
      stream.enqueueChunk(Uint8Array.of(1));
      const mimeType = observe(reader.determineMIMEType());
      const sniffingFailure = expect(mimeType).rejects.toBe(failure);
      await expect.poll(() => reads.mock.calls.length).toBe(2);
      stream.error(failure);
      await sniffingFailure;
      expect(clock.timers[0]!.remove).toHaveBeenCalledOnce();
      expect(() => reader.read()).toThrow('Determine the MIME type before consuming the resource body');
      expect(stream.locked).toBe(false);
    });

  it('treats a null body as EOF', async () => {
    const userAgent = new UserAgent();
    const reader = new ResourceReader(new FetchResponse(), userAgent);
    expect(await observe(reader.determineMIMEType())).toMatchObject({ type: 'text', subtype: 'plain' });
    expect(await observe(reader.read())).toBeNull();
  });
});

function createResource() {
  const userAgent = new UserAgent();
  const cancelled = vi.fn();
  const stream = ReadableStreamImpl.createDefault(undefined, cancelled, 0, () => 1, userAgent.sandbox);
  const response = new FetchResponse();
  response.urlList = [userAgent.parseURL('https://example.test/resource').url!];
  response.body = new FetchBody(stream, userAgent.sandbox);
  return { userAgent, response, stream, cancelled, reader: new ResourceReader(response, userAgent) };
}

function controlSniffingClock(userAgent: UserAgent) {
  const timers: { delay: number; run: () => void; remove: ReturnType<typeof vi.fn>; }[] = [];
  const clock = { now: 100, timers, expire: () => { timers.at(-1)!.run(); } };
  vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => clock.now);
  userAgent.timerHost = {
    scheduleTimeout: (delay, run) => {
      const timer = { delay, run, remove: vi.fn() };
      timers.push(timer);
      return timer;
    },
  };
  return clock;
}

function observe<T>(promise: InternalPromise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => { promise.observe(resolve, reject); });
}
