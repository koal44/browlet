import { createServer, type Server, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getBindingContext, getRelevantRealm, project } from '../../src/browlet/bindings';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse, ResponseImpl } from '../../src/fetch/response';
import { FetchTimingInfo } from '../../src/fetch/timing';
import { observe } from './streams/implementation-fixture';
import { closeServer, listen } from './loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

describe('HTTP cache wire transactions', () => {
  it('serves a fresh response with independent bodies, preserved fields, age, and no second exchange', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'max-age=300', 'Content-Type': 'text/plain', 'X-Extension': 'kept' });
      response.end('cached bytes');
    }));
    const first = await f.get();
    expect(first.cacheUsage).toBeUndefined();
    expect(await f.text(first)).toBe('cached bytes');
    const second = await f.get();
    expect(second.cacheUsage).toBe('local');
    expect(second.headerList.get('Age')).toMatch(/^\d+$/);
    expect(second.headerList.get('X-Extension')).toBe('kept');
    expect(await f.text(second)).toBe('cached bytes');
    expect(await f.text(await f.get())).toBe('cached bytes');
    expect(exchanges).toBe(1);
  });

  it.each(['no-store', 'reload'] as const)('%s controls lookup and replacement', async (mode) => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(200, { 'Cache-Control': 'max-age=300' });
      response.end(String(++exchanges));
    }));
    expect(await f.text(await f.get())).toBe('1');
    expect(await f.text(await f.get(mode))).toBe('2');
    expect(await f.text(await f.get())).toBe(mode === 'reload' ? '2' : '1');
    expect(exchanges).toBe(2);
  });

  it('force-cache and only-if-cached reuse stale responses while a miss avoids the network', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'max-age=0' });
      response.end('old');
    }));
    expect((await f.get('only-if-cached')).type).toBe('error');
    expect(exchanges).toBe(0);
    expect(await f.text(await f.get())).toBe('old');
    expect(await f.text(await f.get('force-cache'))).toBe('old');
    expect(await f.text(await f.get('only-if-cached'))).toBe('old');
    expect(exchanges).toBe(1);
  });

  it('applies explicit request freshness restrictions and the HTTP only-if-cached directive', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(200, { 'Cache-Control': 'max-age=0' });
      response.end(String(++exchanges));
    }));
    expect((await f.get('default', { 'Cache-Control': 'only-if-cached' })).status).toBe(504);
    expect(exchanges).toBe(0);
    expect(await f.text(await f.get())).toBe('1');
    expect(await f.text(await f.get('default', { 'Cache-Control': 'max-stale=300' }))).toBe('1');
    expect((await f.get('default', { 'Cache-Control': 'only-if-cached, no-cache' })).status).toBe(504);
    expect(exchanges).toBe(1);
  });

  it.each(['no-cache', 'max-age=0'])('revalidates %s with both validators and returns retained bytes after 304', async (control) => {
    const seen: { tag?: string; modified?: string; }[] = [];
    const modified = 'Wed, 23 Sep 2026 12:00:00 GMT';
    const f = await fixture(createServer((request, response) => {
      seen.push({ tag: request.headers['if-none-match'], modified: request.headers['if-modified-since'] });
      if (request.headers['if-none-match'] === '"one"') {
        response.writeHead(304, { ETag: '"one"', 'Cache-Control': 'max-age=300', 'X-Validated': 'yes', 'Content-Length': '8' });
        response.end();
      } else {
        response.writeHead(200, { ETag: '"one"', 'Last-Modified': modified, 'Cache-Control': control, 'Content-Length': '8' });
        response.end('original');
      }
    }));
    expect(await f.text(await f.get())).toBe('original');
    const validated = await f.get();
    expect(validated.status).toBe(200);
    expect(validated.cacheUsage).toBe('validated');
    expect(validated.headerList.get('X-Validated')).toBe('yes');
    expect(validated.headerList.get('Content-Length')).toBe('8');
    expect(await f.text(validated)).toBe('original');
    expect(await f.text(await f.get())).toBe('original');
    expect(seen).toEqual([{}, { tag: '"one"', modified }]);
  });

  it('no-cache validates even a fresh response and replaces it when the server sends a full response', async () => {
    const tags: (string | undefined)[] = [];
    const f = await fixture(createServer((request, response) => {
      tags.push(request.headers['if-none-match']);
      response.writeHead(200, { ETag: `"${tags.length}"`, 'Cache-Control': 'max-age=300' });
      response.end(String(tags.length));
    }));
    expect(await f.text(await f.get())).toBe('1');
    expect(await f.text(await f.get('no-cache'))).toBe('2');
    expect(await f.text(await f.get())).toBe('2');
    expect(tags).toEqual([undefined, '"1"']);
  });

  it('forwards authored preconditions unchanged and never adds a second validator', async () => {
    const tags: (string | undefined)[] = [];
    const f = await fixture(createServer((request, response) => {
      tags.push(request.headers['if-none-match']);
      response.writeHead(200, { ETag: '"cached"', 'Cache-Control': 'max-age=300' });
      response.end('body');
    }));
    await f.text(await f.get());
    await f.text(await f.get('default', { 'If-None-Match': '"authored"' }));
    expect(tags).toEqual([undefined, '"authored"']);
  });

  it('matches Vary against the actual outgoing credentials fields and caches private authenticated responses', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'private, max-age=300', Vary: 'Authorization' });
      response.end(request.headers.authorization ?? 'anonymous');
    }));
    expect(await f.text(await f.get('default', { Authorization: 'Basic first' }))).toBe('Basic first');
    expect(await f.text(await f.get('default', { Authorization: 'Basic second' }))).toBe('Basic second');
    expect(await f.text(await f.get('default', { Authorization: 'Basic first' }))).toBe('Basic first');
    expect(await f.text(await f.get())).toBe('anonymous');
    expect(exchanges).toBe(3);
  });

  it('does not replay Set-Cookie when reusing a cached response', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'max-age=300', 'Set-Cookie': 'cookie=original; SameSite=Lax' });
      response.end('body');
    }));
    const receiveCookies = vi.spyOn(FetchResponse.prototype, 'parseAndStoreCookies');
    await f.text(await f.get());
    await f.text(await f.get());
    expect(receiveCookies).toHaveBeenCalledOnce();
    expect(exchanges).toBe(1);
  });

  it('isolates top-level partitions and retains completed bytes across environments', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(200, { 'Cache-Control': 'max-age=300' });
      response.end(String(++exchanges));
    }));
    expect(await f.text(await f.get())).toBe('1');
    await f.browlet.navigate('http://other.test/');
    const otherEnv = getRelevantRealm(f.browlet.window).env;
    const other = f.request(otherEnv);
    expect(await f.text(await observe(other.httpNetworkOrCacheFetch()))).toBe('2');
    await f.browlet.navigate(f.origin);
    const sameSiteEnv = getRelevantRealm(f.browlet.window).env;
    const sameSite = f.request(sameSiteEnv);
    const cached = await observe(sameSite.httpNetworkOrCacheFetch());
    expect(cached.cacheUsage).toBe('local');
    expect(await f.text(cached)).toBe('1');
    expect(exchanges).toBe(2);
  });

  it('invalidates every target variant after an unsafe successful response', async () => {
    let reads = 0;
    const f = await fixture(createServer((request, response) => {
      response.writeHead(200, { 'Cache-Control': 'max-age=300', Vary: 'X-Variant' });
      response.end(request.method === 'GET' ? String(++reads) : 'updated');
    }));
    await f.text(await f.get('default', { 'X-Variant': 'a' }));
    await f.text(await f.get('default', { 'X-Variant': 'b' }));
    await f.text(await f.get('default', {}, 'POST'));
    expect(await f.text(await f.get('default', { 'X-Variant': 'a' }))).toBe('3');
    expect(await f.text(await f.get('default', { 'X-Variant': 'b' }))).toBe('4');
  });

  it('HEAD updates matching GET metadata without replacing the retained body', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'max-age=300', ETag: '"body"', 'Content-Length': '4', 'X-Head': String(request.method === 'HEAD') });
      response.end(request.method === 'HEAD' ? undefined : 'body');
    }));
    await f.text(await f.get());
    const head = await f.get('reload', {}, 'HEAD');
    expect(await f.text(head)).toBe('');
    const cached = await f.get();
    expect(cached.headerList.get('X-Head')).toBe('true');
    expect(await f.text(cached)).toBe('body');
    expect(exchanges).toBe(2);
  });

  it('does not let force-cache reuse a GET invalidated by conflicting HEAD metadata', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'max-age=300', ETag: exchanges === 1 ? '"old"' : '"new"' });
      response.end(request.method === 'HEAD' ? undefined : exchanges === 1 ? 'old' : 'new');
    }));
    await f.text(await f.get());
    await f.text(await f.get('reload', {}, 'HEAD'));
    expect(await f.text(await f.get('force-cache'))).toBe('new');
  });

  it('retains an already completed redirect even if its unused body is discarded', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      exchanges++;
      response.writeHead(301, { 'Cache-Control': 'max-age=300', Location: '/next' });
      response.end('moved');
    }));
    const response = await f.get();
    // The complete write can precede consumption of the queued response bytes.
    await vi.waitFor(() => expect(f.env.userAgent.httpCachePartitions.determine(f.request().request)!.select(f.request().request)).toBeDefined());
    response.discardBody?.();
    expect((await f.get()).cacheUsage).toBe('local');
    expect(exchanges).toBe(1);
  });

  it('retains decoded bytes and body timing metadata without decoding cache hits again', async () => {
    let exchanges = 0;
    const body = gzipSync('compressed cached content');
    const f = await fixture(createServer((_request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'max-age=300', 'Content-Encoding': 'gzip', 'Content-Length': body.length });
      response.end(body);
    }));
    const first = await f.get();
    expect(await f.text(first)).toBe('compressed cached content');
    const cached = await f.get();
    expect(await f.text(cached)).toBe('compressed cached content');
    expect(cached.bodyInfo).toEqual(first.bodyInfo);
    expect(cached.headerList.get('Content-Encoding')).toBe('gzip');
    expect(exchanges).toBe(1);
  });

  it('forwards ranges and leaves partial responses unstored', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((request, response) => {
      exchanges++;
      response.writeHead(request.headers.range ? 206 : 200, { 'Cache-Control': 'max-age=300' });
      response.end(request.headers.range ? 'part' : 'complete');
    }));
    await f.text(await f.get());
    expect(await f.text(await f.get('default', { Range: 'bytes=0-3' }))).toBe('part');
    expect(await f.text(await f.get('default', { Range: 'bytes=0-3' }))).toBe('part');
    expect(await f.text(await f.get())).toBe('complete');
    expect(exchanges).toBe(3);
  });
});

describe('HTTP cache write lifetime', () => {
  it('drops an oversized cache write without truncating the consumer body', async () => {
    let exchanges = 0;
    const bytes = 'a'.repeat(100 * 1024);
    const f = await fixture(createServer((_request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'max-age=300' });
      response.end(bytes);
    }));
    f.env.userAgent.httpCachePartitions.maxEntryBytes = 10;
    expect(await f.text(await f.get())).toBe(bytes);
    expect(await f.text(await f.get())).toBe(bytes);
    expect(exchanges).toBe(2);
  });

  it('abandoning a partial response prevents a later cache hit', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(200, { 'Cache-Control': 'max-age=300' });
      if (++exchanges === 1) response.write('partial');
      else response.end('complete');
    }));
    const params = f.request();
    const response = await observe(params.httpNetworkOrCacheFetch());
    params.controller.abort(f.env);
    await expect(f.text(response)).rejects.toThrow();
    expect(await f.text(await f.get())).toBe('complete');
    expect(exchanges).toBe(2);
  });

  it('clearing during a response prevents it from repopulating the cache', async () => {
    let pending: ServerResponse;
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(200, { 'Cache-Control': 'max-age=300', ETag: '"tracking"' });
      if (++exchanges === 1) { pending = response; response.write('partial'); }
      else { response.end('new'); }
    }));
    const first = await f.get();
    f.browlet.clearHTTPCache();
    pending!.end(' end');
    expect(await f.text(first)).toBe('partial end');
    expect(await f.text(await f.get())).toBe('new');
    expect(exchanges).toBe(2);
  });

  it('a canceled lookup returns an aborted network error even when the entry is fresh', async () => {
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(200, { 'Cache-Control': 'max-age=300' });
      response.end('body');
    }));
    await f.text(await f.get());
    const params = f.request();
    params.controller.abort(f.env);
    expect(await observe(params.httpNetworkOrCacheFetch())).toMatchObject({ type: 'error', aborted: true });
  });

  it('failed decoding never publishes the corrupt response', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      exchanges++;
      response.writeHead(200, { 'Cache-Control': 'max-age=300', 'Content-Encoding': 'gzip' });
      response.end('not gzip');
    }));
    await expect(f.text(await f.get())).rejects.toThrow();
    expect((await f.get('only-if-cached')).type).toBe('error');
    expect(exchanges).toBe(1);
  });

  it('failed HTTP framing never publishes an incomplete response', async () => {
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(200, { 'Cache-Control': 'max-age=300', 'Content-Length': '100' });
      response.write('short');
      setImmediate(() => response.destroy());
    }));
    await expect(f.text(await f.get())).rejects.toThrow();
    expect((await f.get('only-if-cached')).type).toBe('error');
  });

  it('does not apply stale-if-error as an unconditional network-error fallback', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((request, response) => {
      if (++exchanges > 1) { request.socket.destroy(); return; }
      response.writeHead(200, { 'Cache-Control': 'max-age=0, stale-if-error=300' });
      response.end('old');
    }));
    await f.text(await f.get());
    expect((await f.get()).type).toBe('error');
  });
});

describe('stale-while-revalidate', () => {
  it('returns stale bytes immediately and completes a conditional refresh in the background', async () => {
    const refresh = Promise.withResolvers<ServerResponse>();
    let exchanges = 0;
    const f = await fixture(createServer((request, response) => {
      exchanges++;
      if (request.headers['if-none-match'] === '"old"') { refresh.resolve(response); return; }
      response.writeHead(200, { 'Cache-Control': 'max-age=0, stale-while-revalidate=300', ETag: '"old"' });
      response.end('old');
    }));
    expect(await f.text(await f.get())).toBe('old');
    const cached = await f.get();
    expect(cached.cacheUsage).toBe('local');
    expect(await f.text(cached)).toBe('old');
    const pending = await refresh.promise;
    pending.writeHead(200, { 'Cache-Control': 'max-age=300', ETag: '"new"' });
    pending.end('new');
    await vi.waitFor(() => {
      const request = f.request().request;
      expect(f.env.userAgent.httpCachePartitions.determine(request)!.select(request)?.response.headerList.get('ETag')).toBe('"new"');
    });
    expect(await f.text(await f.get())).toBe('new');
    expect(exchanges).toBe(2);
    await vi.waitFor(() => expect(f.env.fetchGroup.fetchRecords.find(({ request }) => request.cacheMode === 'no-cache')!.request.done).toBe(true));
  });

  it('prepares background request cookies once from the original request', async () => {
    const refresh = Promise.withResolvers<string | undefined>();
    const f = await fixture(createServer((request, response) => {
      if (request.headers['if-none-match']) refresh.resolve(request.headers.cookie);
      response.writeHead(200, {
        'Cache-Control': 'max-age=0, stale-while-revalidate=300', ETag: '"old"', 'Set-Cookie': 'cookie=value; SameSite=Lax',
      });
      response.end('old');
    }));
    const preload = vi.spyOn(f.env, 'consumePreloadedResource');
    await f.text(await f.get());
    await f.text(await f.get());
    expect(await refresh.promise).toBe('cookie=value');
    expect(preload).not.toHaveBeenCalled();
  });

  it('terminating the client cancels its outstanding background revalidation', async () => {
    const refresh = Promise.withResolvers<ServerResponse>();
    const closed = Promise.withResolvers<void>();
    const f = await fixture(createServer((request, response) => {
      if (request.headers['if-none-match']) {
        response.on('close', () => closed.resolve());
        refresh.resolve(response);
        return;
      }
      response.writeHead(200, { 'Cache-Control': 'max-age=0, stale-while-revalidate=300', ETag: '"old"' });
      response.end('old');
    }));
    await f.text(await f.get());
    await f.text(await f.get());
    await refresh.promise;
    const record = f.env.fetchGroup.fetchRecords.find(({ request }) => request.cacheMode === 'no-cache')!;
    f.env.fetchGroup.terminate();
    await closed.promise;
    expect(record.controller!.state).toBe('terminated');
  });
});

async function fixture(server: Server) {
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate(origin);
  const env = getRelevantRealm(browlet.window).env;
  cleanup.push(async () => { env.fetchGroup.terminate(); await env.userAgent.httpTransport.close(); });
  const request = (client = env) => {
    const request = new FetchRequest(client.parseURL(origin + '/resource').url!, client, client.userAgent);
    request.populateFromClient();
    request.referrer = null;
    return new FetchParams(request, new FetchTimingInfo(), client);
  };
  const get = (mode: RequestCache = 'default', headers: Record<string, string> = {}, method = 'GET') => {
    const params = request();
    params.request.method = method;
    params.request.cacheMode = mode;
    for (const [name, value] of Object.entries(headers)) params.request.headerList.append(name, value);
    return observe(params.httpNetworkOrCacheFetch());
  };
  const text = (response: FetchResponse) => {
    const context = getBindingContext(getRelevantRealm(browlet.window));
    Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
    return browlet.evaluate(async () => (globalThis as unknown as { networkResponse: Response; }).networkResponse.text());
  };
  return { browlet, env, origin, request, get, text };
}
