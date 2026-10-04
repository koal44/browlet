import { createServer } from 'node:http';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBindingContext, getRelevantRealm, project } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { FetchRequest } from '../../src/fetch/request';
import { ResponseImpl } from '../../src/fetch/response';
import { closeServer, listen } from './loader/http-fixture';
import { createFetchOperation } from './fetch-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

describe('HTTP response content decoding', () => {
  it.each([undefined, ''])('preserves bytes without allocating a decoder for Content-Encoding %j', async (coding) => {
    const plain = 'no content coding';
    const f = await fixture(Buffer.from(plain), coding);
    expect(await f.text()).toBe(plain);
    expect(f.createDecoder).not.toHaveBeenCalled();
    expect(f.response.bodyInfo).toMatchObject({ encodedSize: plain.length, decodedSize: plain.length });
  });

  it.each([
    ['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync],
    ['x-gzip', gzipSync], ['X-GZip', gzipSync],
    ['gzip, br', (bytes: Buffer) => brotliCompressSync(gzipSync(bytes))],
    ['GZip, BR', (bytes: Buffer) => brotliCompressSync(gzipSync(bytes))],
    ['x-gzip, br', (bytes: Buffer) => brotliCompressSync(gzipSync(bytes))],
  ] as const)('decodes %s across wire chunks and records encoded and decoded lengths', async (coding, encode) => {
    const plain = Buffer.from('one response, multiple chunks: '.repeat(64));
    const encoded = encode(plain);
    const f = await fixture(encoded, coding);
    expect(await f.text()).toBe(plain.toString());
    expect(f.response.headerList.get('Content-Encoding')).toBe(coding);
    expect(f.response.bodyInfo).toMatchObject({
      encodedSize: encoded.length, decodedSize: plain.length,
      contentEncoding: coding.includes(',') ? 'multiple' : coding.toLowerCase(),
    });
  });

  it('finishes empty encoded responses without asking a codec to decode nonexistent bytes', async () => {
    const f = await fixture(Buffer.alloc(0), 'gzip');
    expect(await f.text()).toBe('');
    expect(f.operation.controller.state).toBe('ongoing');
  });

  it('bounds decoded expansion while unread and resumes without losing bytes', async () => {
    const plain = Buffer.alloc(512 * 1024, 61);
    const f = await fixture(gzipSync(plain), 'gzip');
    await f.paused;
    // An owner task lets already-arrived bytes reach the stream; no manual checkpoints.
    await f.browlet.evaluate(() => 0);
    expect(f.response.bodyInfo.decodedSize).toBeGreaterThanOrEqual(64 * 1024);
    expect(f.response.bodyInfo.decodedSize).toBeLessThanOrEqual(80 * 1024);
    expect(await f.browlet.evaluate(async () => {
      const reader = (globalThis as unknown as NetworkPage).networkResponse.body!.getReader();
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) return size;
        if (!(value instanceof Uint8Array) || !value.every((byte) => byte === 61)) throw new Error('Invalid decoded chunk');
        size += value.length;
      }
    })).toBe(plain.length);
    expect(f.response.bodyInfo.decodedSize).toBe(plain.length);
  });

  it.each(['unsupported', 'unsupported, gzip', 'gzip, unsupported'])(
    'leaves the entire body encoded without allocating a decoder for %s', async (coding) => {
      const bytes = gzipSync(Buffer.from('leave encoded'));
      const f = await fixture(bytes, coding);
      expect(await f.browlet.evaluate(async () => {
        const response = (globalThis as unknown as NetworkPage).networkResponse;
        return Array.from(new Uint8Array(await response.arrayBuffer()));
      })).toEqual([...bytes]);
      expect(f.createDecoder).not.toHaveBeenCalled();
      expect(f.response.bodyInfo.decodedSize).toBe(bytes.length);
    },
  );

  it.each([
    { name: 'corrupt gzip', coding: 'gzip', bytes: Buffer.from('invalid gzip bytes') },
    { name: 'truncated gzip', coding: 'gzip', bytes: gzipSync(Buffer.from('unfinished')).subarray(0, 10) },
    { name: 'outer coding failure', coding: 'deflate, gzip', bytes: Buffer.from('invalid gzip bytes') },
    { name: 'inner coding failure', coding: 'deflate, gzip', bytes: gzipSync(Buffer.from('invalid deflate bytes')) },
  ])('terminates $name with the consuming page\'s TypeError and no decoded bytes', async ({ coding, bytes }) => {
    const f = await fixture(bytes, coding);
    expect(await f.browlet.evaluate(async () => {
      try { await (globalThis as unknown as NetworkPage).networkResponse.text(); return false; }
      catch (error) { return error instanceof TypeError; }
    })).toBe(true);
    expect(f.operation.controller.state).toBe('terminated');
    expect(f.response.bodyInfo.decodedSize).toBe(0);
  });
});

async function fixture(bytes: Buffer, coding?: string) {
  const server = createServer((_request, response) => {
    response.writeHead(200, coding === undefined ? {} : { 'Content-Encoding': coding });
    // A deterministic split ensures the adapter is not given one complete compressed message.
    const midpoint = Math.max(1, Math.floor(bytes.length / 2));
    response.write(bytes.subarray(0, midpoint));
    setImmediate(() => response.end(bytes.subarray(midpoint)));
  });
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate(origin);
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  const createDecoder = vi.spyOn(env.userAgent, 'createContentDecoder');
  cleanup.push(() => env.userAgent.httpTransport.close());
  const paused = Promise.withResolvers<void>();
  const transport = env.userAgent.httpTransport;
  const dispatch = transport.dispatch.bind(transport);
  vi.spyOn(transport, 'dispatch').mockImplementation((request, listener) => {
    const control = dispatch(request, listener);
    return { ...control, pause() { control.pause(); paused.resolve(); } };
  });
  const request = new FetchRequest(env.parseURL(origin).url!, env, env.userAgent);
  request.populateFromClient();
  request.cacheMode = 'no-store';
  const operation = createFetchOperation(request, env);
  const response = await operation.start();
  const context = getBindingContext(realm);
  Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, [response, 'response'])));
  const text = () => browlet.evaluate(async () => (globalThis as unknown as NetworkPage).networkResponse.text());
  return { browlet, env, operation, response, text, createDecoder, paused: paused.promise };
}

interface NetworkPage { networkResponse: Response; }
