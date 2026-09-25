import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getBindingContext, getRelevantRealm, project, unwrap } from '../../src/browlet/bindings';
import { FetchBody } from '../../src/fetch/body';
import { FetchHeaders } from '../../src/fetch/headers';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse, ResponseImpl } from '../../src/fetch/response';
import { FetchTimingInfo } from '../../src/fetch/timing';
import { NodeHTTPTransport } from '../../src/browlet/loader/node-transport';
import type { ReadableStreamImpl } from '../../src/streams/readable-stream';
import type { HTTPTransport, HTTPTransportListener, HTTPTransportRequest, HTTPUploadSource } from '../../src/fetch/http/transport';
import { observe } from './streams/implementation-fixture';
import { closeServer, listen } from './loader/http-fixture';

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
    f.transport.send(second);
    expect(f.transport.paused).toBe(true);
    expect(f.transport.pause).toHaveBeenCalledOnce();
    // Incoming chunks stay in Fetch's buffer, not a queue of per-chunk HTML tasks.
    expect(queue).not.toHaveBeenCalled();
    expect(await readChunk(f.browlet)).toEqual({ done: false, size: first.length, first: 1, owned: true });
    expect(f.transport.resume).not.toHaveBeenCalled();
    expect(await readChunk(f.browlet)).toEqual({ done: false, size: second.length, first: 2, owned: true });
    expect(f.transport.resume).toHaveBeenCalledOnce();
    expect(first.byteLength).toBe(32 * 1024);
    expect(second.byteLength).toBe(32 * 1024);
    f.transport.send(Uint8Array.of(3));
    f.transport.listener!.onEnd();
    expect(await readChunk(f.browlet)).toMatchObject({ done: false, size: 1, first: 3 });
    expect(await readChunk(f.browlet)).toMatchObject({ done: true });
    // Completion removes this operation's cancellation hook.
    f.params.controller.terminate();
    expect(f.transport.abort).not.toHaveBeenCalled();
  });

  it('satisfies byte reads using the caller buffer and closes a pending BYOB read', async () => {
    const f = await fixture();
    f.transport.send(Uint8Array.of(1, 2, 3));
    f.transport.listener!.onEnd();
    expect(await f.browlet.evaluate(async () => {
      const { networkResponse } = globalThis as unknown as NetworkPage;
      const reader = networkResponse.body!.getReader({ mode: 'byob' });
      const result: number[] = [];
      while (true) {
        const { value, done } = await reader.read(new Uint8Array(2));
        if (done) return result;
        result.push(...value);
      }
    })).toEqual([1, 2, 3]);
  });

  it('reads the upload body on demand and passes duplicate request headers without flattening them', async () => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    const env = getRelevantRealm(browlet.window).env;
    const transport = new ControlledTransport();
    env.userAgent.httpTransport = transport;
    const request = new FetchRequest(env.parseURL('https://example.test/upload').url!, env, env.userAgent);
    request.method = 'POST';
    request.headerList.append('X-Value', 'one');
    request.headerList.append('X-Value', 'two');
    const bytes = Uint8Array.of(1, 2, 3);
    request.body = FetchBody.fromBytes(bytes, env);
    const params = new FetchParams(request, new FetchTimingInfo(), env);
    await observe(params.httpNetworkFetch(true, true));
    expect(transport.request).toMatchObject({ includeCredentials: true, forceNewConnection: true });
    expect(request.body.stream.disturbed).toBe(false);
    const upload = transport.request!.body as HTTPUploadSource;
    expect(await observe(upload.read())).toEqual(bytes);
    expect(request.body.stream.disturbed).toBe(true);
    expect(await observe(upload.read())).toBeNull();
    expect(transport.request!.headers.list).toEqual([['X-Value', 'one'], ['X-Value', 'two']]);
    transport.listener!.onEnd();
  });
});

describe('HTTP network cancellation and failures', () => {
  it('discards an exchange with a pending upload read without terminating the redirect controller', async () => {
    const f = await fixture(false);
    await f.browlet.evaluate(() => { Reflect.set(globalThis, 'uploadStream', new ReadableStream()); });
    f.params.request.body = new FetchBody(unwrap<ReadableStreamImpl>(Reflect.get(f.browlet.window, 'uploadStream') as ReadableStream), f.env);
    const response = await observe(f.params.httpNetworkFetch());
    const pending = observe((f.transport.request!.body as HTTPUploadSource).read());
    await f.browlet.evaluate(() => 0);
    response.discardBody!();
    expect(await pending).toBeNull();
    await f.browlet.evaluate(() => 0);
    expect(f.params.controller.state).toBe('ongoing');
    expect(f.transport.abort).toHaveBeenCalledOnce();
  });

  it.each([true, false])('classifies an upload failure by its DOMException brand (genuine: %s)', async (genuine) => {
    const f = await fixture(false);
    f.transport.headers = false;
    await f.browlet.evaluate((real) => {
      const failure = real ? new DOMException('stopped', 'AbortError') : { name: 'AbortError' };
      Reflect.set(globalThis, 'uploadStream', new ReadableStream({ start(controller) { controller.error(failure); } }));
    }, genuine);
    f.params.request.method = 'POST';
    f.params.request.body = new FetchBody(unwrap<ReadableStreamImpl>(Reflect.get(f.browlet.window, 'uploadStream') as ReadableStream), f.env);
    const pending = observe(f.params.httpNetworkFetch());
    await f.transport.dispatched.promise;
    await observe((f.transport.request!.body as HTTPUploadSource).read());
    expect(await pending).toMatchObject({ type: 'error', aborted: genuine });
    expect(f.params.controller.state).toBe(genuine ? 'aborted' : 'terminated');
  });

  it('does not dispatch an already aborted request', async () => {
    const f = await fixture(false);
    f.params.controller.abort('stop', f.env);
    const response = await observe(f.params.httpNetworkFetch());
    expect(response.type).toBe('error');
    expect(response.aborted).toBe(true);
    expect(f.transport.listener).toBeUndefined();
  });

  it('aborts a request waiting for response headers', async () => {
    const f = await fixture(false);
    f.transport.headers = false;
    const pending = observe(f.params.httpNetworkFetch());
    await f.transport.dispatched.promise;
    f.params.controller.abort('stop', f.env);
    expect(await pending).toMatchObject({ type: 'error', aborted: true });
    expect(f.transport.abort).toHaveBeenCalledOnce();
  });

  it('propagates body cancellation while the network is paused', async () => {
    const f = await fixture();
    f.transport.send(new Uint8Array(64 * 1024));
    await f.browlet.evaluate(async () => {
      const { networkResponse } = globalThis as unknown as NetworkPage;
      await networkResponse.body!.cancel('finished reading');
    });
    expect(f.params.controller.state).toBe('aborted');
    expect(f.transport.abort).toHaveBeenCalledOnce();
    expect(f.transport.resume).not.toHaveBeenCalled();
  });

  it('converts a connection failure before headers to a network error', async () => {
    const f = await fixture(false);
    f.transport.headers = false;
    const pending = observe(f.params.httpNetworkFetch());
    await f.transport.dispatched.promise;
    f.transport.listener!.onError(new Error('native socket error'));
    expect(await pending).toMatchObject({ type: 'error', aborted: false });
    expect(f.params.controller.state).toBe('terminated');
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
    f.params.controller.abort('stopped', f.env);
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
    const transport = new NodeHTTPTransport();
    f.env.userAgent.httpTransport = transport;
    f.params.request.urlList = [f.env.parseURL(origin).url!];
    f.params.request.method = 'POST';
    await f.browlet.evaluate(() => {
      Reflect.set(globalThis, 'uploadStream', new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }));
    });
    f.params.request.body = new FetchBody(unwrap<ReadableStreamImpl>(Reflect.get(f.browlet.window, 'uploadStream') as ReadableStream), f.env);
    try {
      expect((await observe(f.params.httpNetworkFetch())).type).toBe('error');
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
    const realm = getRelevantRealm(browlet.window);
    const env = realm.env;
    try {
      const request = new FetchRequest(env.parseURL(origin + '/bytes').url!, env, env.userAgent);
      const params = new FetchParams(request, new FetchTimingInfo(), env);
      const response = await observe(params.httpNetworkFetch());
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
    const realm = getRelevantRealm(browlet.window);
    const env = realm.env;
    try {
      const request = new FetchRequest(env.parseURL(origin).url!, env, env.userAgent);
      const params = new FetchParams(request, new FetchTimingInfo(), env);
      const response = await observe(params.httpNetworkFetch());
      const context = getBindingContext(realm);
      Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
      await browlet.evaluate(async () => {
        const { networkResponse } = globalThis as unknown as NetworkPage;
        await networkResponse.body!.cancel('enough');
      });
      await disconnected.promise;
      expect(params.controller.state).toBe('aborted');
    } finally {
      await env.userAgent.httpTransport.close();
      await closeServer(server);
    }
  });
});

async function fixture(start = true) {
  const browlet = new Browlet({ route: () => '', reporting: false });
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  const transport = new ControlledTransport();
  env.userAgent.httpTransport = transport;
  const request = new FetchRequest(env.parseURL('https://example.test/data').url!, env, env.userAgent);
  const params = new FetchParams(request, new FetchTimingInfo(), env);
  const response = start ? await observe(params.httpNetworkFetch()) : new FetchResponse();
  if (start) {
    const context = getBindingContext(realm);
    Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
  }
  return { browlet, env, transport, params, response };
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
