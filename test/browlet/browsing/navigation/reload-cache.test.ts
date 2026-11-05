import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import { fetch, type FetchResponse } from '../../../../src/fetch/index';
import { unwrap } from '../../../support/browlet-binding';
import { closeServer, listen } from '../../loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

describe('reload navigation HTTP cache policy', () => {
  it.each(['etag', 'last-modified', 'both'] as const)('revalidates a fresh response with %s and retains its body after 304', async (validator) => {
    const headers = {
      'Content-Type': 'text/html', 'Cache-Control': 'max-age=3600',
      ...(validator !== 'last-modified' ? { ETag: '"retained"' } : {}),
      ...(validator !== 'etag' ? { 'Last-Modified': 'Wed, 04 Nov 2026 10:00:00 GMT' } : {}),
    };
    const requests: IncomingHttpHeaders[] = [];
    const f = await fixture(createServer((request, response) => {
      requests.push(request.headers);
      const unmodified = request.headers['if-none-match'] === headers.ETag && headers.ETag !== undefined ||
        request.headers['if-modified-since'] === headers['Last-Modified'] && headers['Last-Modified'] !== undefined;
      response.writeHead(unmodified ? 304 : 200, headers);
      response.end(unmodified ? undefined : 'retained body');
    }));

    expect((await f.get()).body).toBe('retained body');
    expect((await f.get()).response.cacheUsage).toBe('local');
    expect(requests).toHaveLength(1);
    f.entry.documentState.reloadPending = true;

    const result = await f.get();

    expect(requests).toHaveLength(2);
    expect(requests[1]!['if-none-match']).toBe(headers.ETag);
    expect(requests[1]!['if-modified-since']).toBe(headers['Last-Modified']);
    expect(requests[1]!['cache-control']).toBe('max-age=0');
    expect(requests[1]!.pragma).toBeUndefined();
    expect(result.response.status).toBe(200);
    expect(result.response.cacheUsage).toBe('validated');
    expect(result.body).toBe('retained body');
  });

  it('retrieves changed content and replaces the cache entry for later ordinary navigation', async () => {
    let version = 1;
    const tags: (string | undefined)[] = [];
    const f = await fixture(createServer((request, response) => {
      tags.push(request.headers['if-none-match']);
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'max-age=3600', ETag: `"${version}"` });
      response.end(`version ${version}`);
    }));
    expect((await f.get()).body).toBe('version 1');
    version = 2;
    f.entry.documentState.reloadPending = true;

    expect((await f.get()).body).toBe('version 2');

    f.entry.documentState.reloadPending = false;
    f.entry.documentState.everPopulated = true;
    const retained = await f.get();
    expect(retained.body).toBe('version 2');
    expect(retained.response.cacheUsage).toBe('local');
    expect(tags).toEqual([undefined, '"1"']);
  });

  it('contacts the server without inventing validators when the cached response has none', async () => {
    const requests: IncomingHttpHeaders[] = [];
    const f = await fixture(createServer((request, response) => {
      requests.push(request.headers);
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'max-age=3600' });
      response.end(String(requests.length));
    }));
    expect((await f.get()).body).toBe('1');
    f.entry.documentState.reloadPending = true;

    expect((await f.get()).body).toBe('2');

    expect(requests).toHaveLength(2);
    expect(requests[1]!['if-none-match']).toBeUndefined();
    expect(requests[1]!['if-modified-since']).toBeUndefined();
    expect(requests[1]!['cache-control']).toBe('max-age=0');
  });

  it('reports a failed reload instead of silently using the fresh cached response', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((request, response) => {
      if (++exchanges > 1) { request.socket.destroy(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'max-age=3600', ETag: '"retained"' });
      response.end('retained body');
    }));
    expect((await f.get()).body).toBe('retained body');
    f.entry.documentState.reloadPending = true;

    const result = await f.get();

    expect(result.response.type).toBe('error');
    expect(result.body).toBeNull();
    expect(exchanges).toBeGreaterThan(1);
  });
});

async function fixture(server: Server) {
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate(origin);
  const document = unwrap<DocumentImpl>(browlet.document);
  const env = document.env;
  cleanup.push(async () => { env.fetchGroup.terminate(); await env.userAgent.httpTransport.close(); });
  const navigable = document.getNodeNavigable()!;
  // Transient activation remains unfinished and is independent of cache selection.
  vi.spyOn(navigable.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
  const source = new SourceSnapshotParams(document);
  const entry = env.createSessionHistoryEntry(env.parseURL(`${origin}/document`)!, DocumentState.create(document));
  const get = async () => {
    const request = entry.createNavigationRequest(navigable, source, env);
    const result = Promise.withResolvers<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>();
    fetch(request, {
      useParallelQueue: true,
      processResponseConsumeBody: (response, body) => { result.resolve({ response, body }); },
    }, env);
    const { response, body } = await result.promise;
    return { response, body: body instanceof Uint8Array ? new TextDecoder().decode(body) : body };
  };
  return { entry, get };
}
