import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBindingContext, getRelevantRealm, project, unwrap } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { NodeHTTPTransport } from '../../src/browlet/loader/node-transport';
import { FetchBody } from '../../src/fetch/body';
import { FetchHeaders } from '../../src/fetch/headers';
import type { HTTPTransport, HTTPTransportListener, HTTPTransportRequest, HTTPUploadSource } from '../../src/fetch/transport';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse, ResponseImpl } from '../../src/fetch/response';
import type { ReadableStreamImpl } from '../../src/streams/readable-stream';
import { closeServer, listen } from './loader/http-fixture';
import { observe } from './streams/implementation-fixture';
import { createFetchOperation } from './fetch-fixture';

afterEach(() => vi.restoreAllMocks());

describe('HTTP network response streams', () => {
  it('delivers ordered bytes through the running page and drains bytes received before EOF', async () => {
    const f = await fixture();
    f.transport.send(Uint8Array.of(1, 2));
    f.transport.send(Uint8Array.of(3, 4, 5));
    f.transport.listener!.onEnd();
    expect(await f.browlet.evaluate(async () => {
      const { networkResponse } = globalThis as unknown as NetworkPage;
      return Array.from(new Uint8Array(await networkResponse.arrayBuffer()));
    })).toEqual([1, 2, 3, 4, 5]);
    expect(f.transport.abort).not.toHaveBeenCalled();
    expect(f.response.bodyInfo.encodedSize).toBe(5);
  });

  it('completes an empty response and a pending read at EOF', async () => {
    const f = await fixture();
    const read = readChunk(f.browlet);
    f.transport.listener!.onEnd();
    expect(await read).toEqual({ done: true, size: 0, owned: true });
  });

  it('bounds an unread body, resumes below the lower limit, and preserves chunk ownership', async () => {
    const f = await fixture();
    const queue = vi.spyOn(f.env.exec.networking, 'queueGlobalTask');
    const first = new Uint8Array(32 * 1024).fill(1);
    const second = new Uint8Array(32 * 1024).fill(2);
    f.transport.send(first);
    const queued = queue.mock.calls.length;
    f.transport.send(second);
    expect(f.transport.paused).toBe(true);
    expect(f.transport.pause).toHaveBeenCalledOnce();
    // Buffering unread chunks does not queue a networking task per chunk.
    expect(queue).toHaveBeenCalledTimes(queued);
    expect(await readChunk(f.browlet)).toEqual({ done: false, size: first.length, first: 1, owned: true });
    expect(await readChunk(f.browlet)).toEqual({ done: false, size: second.length, first: 2, owned: true });
    expect(f.transport.resume).toHaveBeenCalledOnce();
    expect(first.byteLength).toBe(32 * 1024);
    expect(second.byteLength).toBe(32 * 1024);
    f.transport.send(Uint8Array.of(3));
    f.transport.listener!.onEnd();
    expect(await readChunk(f.browlet)).toMatchObject({ done: false, size: 1, first: 3 });
    expect(await readChunk(f.browlet)).toMatchObject({ done: true });
    // Completion removes this operation's cancellation hook.
    f.operation.controller.terminate();
    expect(f.transport.abort).not.toHaveBeenCalled();
  });

  it.each([false, true])('satisfies byte reads and closes a pending BYOB read (cloned: %s)', async (cloned) => {
    const f = await fixture();
    f.transport.send(Uint8Array.of(1, 2, 3));
    f.transport.listener!.onEnd();
    expect(await f.browlet.evaluate(async (clone) => {
      const { networkResponse } = globalThis as unknown as NetworkPage;
      // SPEC_CLASH(fetch-finale-byte-stream): Preserve BYOB through Fetch finale and cloning.
      const response = clone ? networkResponse.clone() : networkResponse;
      const reader = response.body!.getReader({ mode: 'byob' });
      const result: number[] = [];
      while (true) {
        const { value, done } = await reader.read(new Uint8Array(2));
        if (done) return result;
        result.push(...value);
      }
    }, cloned)).toEqual([1, 2, 3]);
  });

  it('reads the upload body on demand and passes duplicate request headers without flattening them', async () => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    await browlet.navigate('https://example.test/');
    const env = getRelevantRealm(browlet.window).env;
    const transport = new ControlledTransport();
    env.userAgent.httpTransport = transport;
    const request = new FetchRequest(env.parseURL('https://example.test/upload').url!, env, env.userAgent);
    request.method = 'POST';
    request.credentialsMode = 'include';
    request.headerList.append('X-Value', 'one');
    request.headerList.append('X-Value', 'two');
    const bytes = Uint8Array.of(1, 2, 3);
    request.body = FetchBody.fromBytes(bytes, env);
    request.populateFromClient();
    request.cacheMode = 'no-store';
    const operation = createFetchOperation(request, env);
    await operation.start();
    expect(transport.request).toMatchObject({ includeCredentials: true, forceNewConnection: false });
    expect(request.body.stream.disturbed).toBe(false);
    const upload = transport.request!.body as HTTPUploadSource;
    expect(await observe(upload.read())).toEqual(bytes);
    expect(request.body.stream.disturbed).toBe(true);
    expect(await observe(upload.read())).toBeNull();
    expect(transport.request!.headers.list.filter(([name]) => name === 'X-Value')).toEqual([['X-Value', 'one'], ['X-Value', 'two']]);
    expect(request.headerList.list.filter(([name]) => name === 'X-Value')).toEqual([['X-Value', 'one'], ['X-Value', 'two']]);
    transport.listener!.onEnd();
  });
});

describe('HTTP network cancellation and failures', () => {
  it('discards an exchange with a pending upload read without terminating the redirect controller', async () => {
    const f = await fixture(false);
    await f.browlet.evaluate(() => { Reflect.set(globalThis, 'uploadStream', new ReadableStream()); });
    f.operation.request.method = 'POST';
    f.operation.request.body = new FetchBody(unwrap<ReadableStreamImpl>(Reflect.get(f.browlet.window, 'uploadStream') as ReadableStream), f.env);
    const response = await f.operation.start();
    const pending = observe((f.transport.request!.body as HTTPUploadSource).read());
    await f.browlet.evaluate(() => 0);
    response.discardBody!();
    expect(await pending).toBeNull();
    await f.browlet.evaluate(() => 0);
    expect(f.operation.controller.state).toBe('ongoing');
    expect(f.transport.abort).toHaveBeenCalledOnce();
  });

  it.each([true, false])('classifies an upload failure by its DOMException brand (genuine: %s)', async (genuine) => {
    const f = await fixture(false);
    f.transport.headers = false;
    await f.browlet.evaluate((real) => {
      const failure = real ? new DOMException('stopped', 'AbortError') : { name: 'AbortError' };
      Reflect.set(globalThis, 'uploadStream', new ReadableStream({ start(controller) { controller.error(failure); } }));
    }, genuine);
    f.operation.request.method = 'POST';
    f.operation.request.body = new FetchBody(unwrap<ReadableStreamImpl>(Reflect.get(f.browlet.window, 'uploadStream') as ReadableStream), f.env);
    const pending = f.operation.start();
    await f.transport.dispatched.promise;
    await observe((f.transport.request!.body as HTTPUploadSource).read());
    expect(await pending).toMatchObject({ type: 'error', aborted: genuine });
    expect(f.operation.controller.state).toBe(genuine ? 'aborted' : 'terminated');
  });

  it('does not dispatch an already aborted request', async () => {
    const f = await fixture(false);
    const pending = f.operation.start();
    f.operation.controller.abort('stop', f.env);
    const response = await pending;
    expect(response.type).toBe('error');
    expect(response.aborted).toBe(true);
    expect(f.transport.listener).toBeUndefined();
  });

  it('aborts a request waiting for response headers', async () => {
    const f = await fixture(false);
    f.transport.headers = false;
    const pending = f.operation.start();
    await f.transport.dispatched.promise;
    f.operation.controller.abort('stop', f.env);
    expect(await pending).toMatchObject({ type: 'error', aborted: true });
    expect(f.transport.abort).toHaveBeenCalledOnce();
  });

  it('propagates body cancellation while the network is paused', async () => {
    const f = await fixture();
    f.transport.send(new Uint8Array(64 * 1024));
    f.transport.resume.mockImplementation(() => expect(f.operation.controller.state).toBe('ongoing'));
    await f.browlet.evaluate(async () => {
      const { networkResponse } = globalThis as unknown as NetworkPage;
      await networkResponse.body!.cancel('finished reading');
    });
    expect(f.operation.controller.state).toBe('aborted');
    expect(f.transport.abort).toHaveBeenCalledOnce();
  });

  it('converts a connection failure before headers to a network error', async () => {
    const f = await fixture(false);
    f.transport.headers = false;
    const pending = f.operation.start();
    await f.transport.dispatched.promise;
    f.transport.listener!.onError(new Error('native socket error'));
    expect(await pending).toMatchObject({ type: 'error', aborted: false });
    expect(f.operation.controller.state).toBe('terminated');
  });

  it('rejects a page body read with its own TypeError after a network failure', async () => {
    const f = await fixture();
    f.transport.listener!.onError(new Error('native socket error'));
    expect(await f.browlet.evaluate(async () => {
      const { networkResponse } = globalThis as unknown as NetworkPage;
      try { await networkResponse.text(); return false; }
      catch (error) { return error instanceof TypeError; }
    })).toBe(true);
  });

  it('delivers the serialized abort reason when cancellation races with queued body bytes', async () => {
    const f = await fixture();
    f.transport.send(Uint8Array.of(1));
    f.operation.controller.abort('stopped', f.env);
    expect(await f.browlet.evaluate(async () => {
      const { networkResponse } = globalThis as unknown as NetworkPage;
      try { await networkResponse.text(); return 'unexpected success'; }
      catch (error) { return error; }
    })).toBe('stopped');
  });
});

describe('HTTP network responses through the real transport and page', () => {
  it('rejects a source-less upload on HTTP/1 before sending the request', async () => {
    const seen = vi.fn();
    const server = createServer((request, response) => { seen(request); response.end(); });
    const origin = await listen(server);
    const f = await fixture(false);
    // Restore the real adapter for the protocol decision.
    const transport = new NodeHTTPTransport(f.env.userAgent);
    const dispatch = vi.spyOn(transport, 'dispatch');
    f.env.userAgent.httpTransport = transport;
    f.operation.request.urlList = [f.env.parseURL(origin).url!];
    f.operation.request.method = 'POST';
    await f.browlet.evaluate(() => {
      Reflect.set(globalThis, 'uploadStream', new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }));
    });
    f.operation.request.body = new FetchBody(unwrap<ReadableStreamImpl>(Reflect.get(f.browlet.window, 'uploadStream') as ReadableStream), f.env);
    try {
      expect((await f.operation.start()).type).toBe('error');
      expect(dispatch).toHaveBeenCalledOnce();
      expect(seen).not.toHaveBeenCalled();
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('streams a real response into page-owned chunks through the automatic event loop', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(Buffer.alloc(192 * 1024, 23));
    });
    const origin = await listen(server);
    const browlet = new Browlet({ route: () => '', reporting: false });
    await browlet.navigate(origin);
    const realm = getRelevantRealm(browlet.window);
    const env = realm.env;
    try {
      const request = new FetchRequest(env.parseURL(origin + '/bytes').url!, env, env.userAgent);
      request.populateFromClient();
      request.cacheMode = 'no-store';
      const operation = createFetchOperation(request, env);
      const response = await operation.start();
      const context = getBindingContext(realm);
      Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
      expect(await browlet.evaluate(async () => {
        const { networkResponse } = globalThis as unknown as NetworkPage;
        const reader = networkResponse.body!.getReader();
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) return size;
          if (!(value instanceof Uint8Array) || !value.every((byte) => byte === 23)) {
            throw new Error('Incorrect network chunk');
          }
          size += value.byteLength;
        }
      })).toBe(192 * 1024);
      expect(response.bodyInfo.encodedSize).toBe(192 * 1024);
    } finally {
      await env.userAgent.httpTransport.close();
      await closeServer(server);
    }
  });

  it('aborts the real exchange when the page cancels its response body', async () => {
    const disconnected = Promise.withResolvers<void>();
    const server = createServer((_request, response) => {
      response.on('close', () => disconnected.resolve());
      response.write('still sending');
    });
    const origin = await listen(server);
    const browlet = new Browlet({ route: () => '', reporting: false });
    await browlet.navigate(origin);
    const realm = getRelevantRealm(browlet.window);
    const env = realm.env;
    try {
      const request = new FetchRequest(env.parseURL(origin).url!, env, env.userAgent);
      request.populateFromClient();
      request.cacheMode = 'no-store';
      const operation = createFetchOperation(request, env);
      const response = await operation.start();
      const context = getBindingContext(realm);
      Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
      await browlet.evaluate(async () => {
        const { networkResponse } = globalThis as unknown as NetworkPage;
        await networkResponse.body!.cancel('enough');
      });
      await disconnected.promise;
      expect(operation.controller.state).toBe('aborted');
    } finally {
      await env.userAgent.httpTransport.close();
      await closeServer(server);
    }
  });
});

async function fixture(start = true) {
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate('https://example.test/');
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  const transport = new ControlledTransport();
  env.userAgent.httpTransport = transport;
  const request = new FetchRequest(env.parseURL('https://example.test/data').url!, env, env.userAgent);
  request.populateFromClient();
  request.cacheMode = 'no-store';
  const operation = createFetchOperation(request, env);
  const response = start ? await operation.start() : new FetchResponse();
  if (start) {
    const context = getBindingContext(realm);
    Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
  }
  return { browlet, env, transport, operation, response };
}

function readChunk(browlet: Browlet) {
  return browlet.evaluate(async () => {
    const page = globalThis as unknown as NetworkPage;
    page.networkReader ??= page.networkResponse.body!.getReader();
    const { value, done } = await page.networkReader.read();
    return { done, size: value?.byteLength ?? 0, first: value?.[0], owned: done || value instanceof Uint8Array };
  });
}

interface NetworkPage {
  networkResponse: Response;
  networkReader?: ReadableStreamDefaultReader<Uint8Array>;
}

class ControlledTransport implements HTTPTransport {
  request: HTTPTransportRequest | undefined;
  listener: HTTPTransportListener | undefined;
  dispatched = Promise.withResolvers<void>();
  headers = true;
  paused = false;
  pause = vi.fn(() => { this.paused = true; });
  resume = vi.fn(() => { this.paused = false; });
  abort = vi.fn();

  dispatch(request: HTTPTransportRequest, listener: HTTPTransportListener) {
    this.request = request;
    this.listener = listener;
    if (this.headers) listener.onHeaders(200, 'OK', new FetchHeaders(), false);
    this.dispatched.resolve();
    return { pause: this.pause, resume: this.resume, abort: this.abort };
  }

  send(bytes: Uint8Array): void {
    if (this.paused) throw new Error('Test transport is paused');
    this.listener!.onData(bytes);
  }

  async close(): Promise<void> {}
}
