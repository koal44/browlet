import { createServer, type RequestListener } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { PerformanceResourceTiming } from '../../../src/browlet/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from '../loader/http-fixture';

type ResourceTimingJSON = Omit<PerformanceResourceTiming, 'toJSON'>;

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Fetch-produced Resource Timing', () => {
  it('retains one public resource entry when an HTTP response body completes', async () => {
    const { browser, origin } = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('hello');
    });
    const entries = await browser.evaluate(async () => {
      const response = await fetch('/resource');
      await response.text();
      return performance.getEntriesByType('resource').map((entry) => entry.toJSON() as ResourceTimingJSON);
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: `${origin}/resource`, entryType: 'resource', initiatorType: 'fetch',
      encodedBodySize: 5, decodedBodySize: 5, transferSize: 305, responseStatus: 200,
    });
  });

  it('delivers the same realm-owned entry to observers and the resource buffer', async () => {
    const { browser } = await fixture((_request, response) => { response.end('observed'); });
    const result = await browser.evaluate(async () => {
      const delivered = new Promise<PerformanceEntry>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          observer.disconnect();
          resolve(list.getEntries()[0]!);
        });
        observer.observe({ type: 'resource' });
      });
      await (await fetch('/observed')).text();
      const entry = await delivered;
      return {
        same: entry === performance.getEntriesByName(entry.name)[0],
        ownRealm: Object.getPrototypeOf(entry) === PerformanceResourceTiming.prototype,
        count: performance.getEntriesByType('resource').length,
      };
    });
    expect(result).toEqual({ same: true, ownRealm: true, count: 1 });
  });

  // Approved dependency: UserAgent.supportsMIMEType() has no installed content-handler support policy yet.
  it.fails('exposes the supported text/plain MIME type', async () => {
    const { browser } = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('plain');
    });
    const entry = await browser.evaluate(async () => {
      await (await fetch('/plain')).text();
      return performance.getEntriesByType('resource')[0]!.toJSON() as ResourceTimingJSON;
    });
    expect(entry.contentType).toBe('text/plain');
  });

  it.each([false, true])('exposes readable body sizes independently of TAO: %s', async (tao) => {
    const bytes = Buffer.from('resource body '.repeat(20));
    const encoded = gzipSync(bytes);
    const foreign = await serverOrigin((_request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (tao) response.setHeader('Timing-Allow-Origin', '*');
      response.writeHead(200, {
        'Content-Type': 'application/problem+json; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store',
      });
      response.end(encoded);
    });
    const { browser } = await fixture((_request, response) => { response.end(); });
    const entry = await browser.evaluate(async (url) => {
      await (await fetch(url)).text();
      return performance.getEntriesByType('resource')[0]!.toJSON() as ResourceTimingJSON;
    }, `${foreign}/resource`);
    expect(entry).toMatchObject({
      responseStatus: 200, contentType: 'application/json', contentEncoding: 'gzip',
      encodedBodySize: encoded.length, decodedBodySize: bytes.length,
      transferSize: tao ? encoded.length + 300 : 0,
    });
    expect(entry.responseEnd).toBeGreaterThanOrEqual(entry.startTime);
    if (tao) expect(entry.requestStart).toBeGreaterThanOrEqual(entry.fetchStart);
    else expect(entry).toMatchObject({ domainLookupStart: 0, connectStart: 0, requestStart: 0, responseStart: 0, nextHopProtocol: '' });
  });

  it.each([false, true])('keeps an opaque response private even with TAO: %s', async (tao) => {
    // A null body completes independently of any inaccessible opaque-body consumption.
    const foreign = await serverOrigin((_request, response) => {
      if (tao) response.setHeader('Timing-Allow-Origin', '*');
      response.writeHead(204, { 'Content-Type': 'text/plain' });
      response.end();
    });
    const { browser } = await fixture((_request, response) => { response.end(); });
    const entry = await browser.evaluate(async (url) => {
      const delivered = new Promise<PerformanceEntry>((resolve) => {
        const observer = new PerformanceObserver((list) => { observer.disconnect(); resolve(list.getEntries()[0]!); });
        observer.observe({ type: 'resource' });
      });
      await fetch(url, { mode: 'no-cors' });
      return (await delivered).toJSON() as ResourceTimingJSON;
    }, `${foreign}/opaque`);
    expect(entry).toMatchObject({
      responseStatus: 0, contentType: '', contentEncoding: '',
      encodedBodySize: 0, decodedBodySize: 0, transferSize: 0,
    });
    if (tao) expect(entry.requestStart).toBeGreaterThanOrEqual(entry.fetchStart);
    else expect(entry.requestStart).toBe(0);
  });

  it('reports fresh-cache and validated-cache sizes without replaying historical connection timestamps', async () => {
    const requests: (string | undefined)[] = [];
    const { browser } = await fixture((request, response) => {
      requests.push(request.headers['if-none-match']);
      response.setHeader('ETag', '"v1"');
      response.setHeader('Cache-Control', 'max-age=300');
      if (request.headers['if-none-match']) response.writeHead(304);
      response.end(request.headers['if-none-match'] ? undefined : 'cached');
    });
    const entries = await browser.evaluate(async () => {
      await (await fetch('/cache')).text();
      await (await fetch('/cache')).text();
      await (await fetch('/cache', { cache: 'no-cache' })).text();
      return performance.getEntriesByType('resource').map((entry) => entry.toJSON() as ResourceTimingJSON);
    });
    expect(requests).toEqual([undefined, '"v1"']);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.transferSize)).toEqual([306, 0, 300]);
    for (const entry of entries) {
      expect(entry).toMatchObject({ encodedBodySize: 6, decodedBodySize: 6, responseStatus: 200, secureConnectionStart: 0 });
      expect(entry.domainLookupStart).toBeGreaterThanOrEqual(entry.fetchStart);
      expect(entry.connectEnd).toBeGreaterThanOrEqual(entry.domainLookupStart);
      expect(entry.requestStart).toBeGreaterThanOrEqual(entry.connectEnd);
      expect(entry.responseStart).toBeGreaterThanOrEqual(entry.requestStart);
      expect(entry.responseEnd).toBeGreaterThanOrEqual(entry.responseStart);
    }
    expect(entries[1]).toMatchObject({ deliveryType: 'cache', nextHopProtocol: '' });
  });

  it.each([false, true])('requires every redirect hop to pass TAO: %s', async (redirectTAO) => {
    const foreign = await serverOrigin((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/target' || redirectTAO) response.setHeader('Timing-Allow-Origin', '*');
      if (request.url === '/redirect') { response.writeHead(302, { Location: '/target' }); response.end(); }
      else { response.end('target'); }
    });
    const { browser } = await fixture((_request, response) => { response.end(); });
    const entry = await browser.evaluate(async (url) => {
      await (await fetch(url)).text();
      return performance.getEntriesByType('resource')[0]!.toJSON() as ResourceTimingJSON;
    }, `${foreign}/redirect`);
    expect(entry).toMatchObject({
      name: `${foreign}/redirect`, encodedBodySize: 6, decodedBodySize: 6,
      responseStatus: 200, transferSize: redirectTAO ? 306 : 0,
    });
    if (redirectTAO) {
      expect(entry.redirectStart).toBeGreaterThan(0);
      expect(entry.redirectEnd).toBeGreaterThanOrEqual(entry.redirectStart);
      expect(entry.fetchStart).toBeGreaterThanOrEqual(entry.redirectEnd);
    } else { expect(entry).toMatchObject({ redirectStart: 0, redirectEnd: 0, requestStart: 0, nextHopProtocol: '' }); }
  });

  it('does not publish non-HTTP fetches as resources', async () => {
    const { browser } = await fixture((_request, response) => { response.end(); });
    expect(await browser.evaluate(async () => {
      await (await fetch('data:text/plain,hello')).text();
      return performance.getEntriesByType('resource').length;
    })).toBe(0);
  });

  it('reports a failed HTTP fetch once without exposing response details', async () => {
    const { browser } = await fixture((request) => { request.socket.destroy(); });
    const result = await browser.evaluate(async () => {
      const delivered = new Promise<PerformanceEntry>((resolve) => {
        const observer = new PerformanceObserver((list) => { observer.disconnect(); resolve(list.getEntries()[0]!); });
        observer.observe({ type: 'resource' });
      });
      let failed = false;
      try { await fetch('/failed'); } catch (error) { failed = error instanceof TypeError; }
      return { failed, entry: (await delivered).toJSON() as ResourceTimingJSON, count: performance.getEntriesByType('resource').length };
    });
    expect(result.failed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.entry).toMatchObject({
      responseStatus: 0, transferSize: 0, encodedBodySize: 0,
      decodedBodySize: 0, requestStart: 0, responseStart: 0, nextHopProtocol: '',
    });
    expect(result.entry.responseEnd).toBeGreaterThanOrEqual(result.entry.startTime);
  });
});

async function serverOrigin(listener: RequestListener) {
  const server = createServer(listener);
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  return origin;
}

async function fixture(listener: RequestListener) {
  const origin = await serverOrigin(listener);
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate(`${origin}/page`);
  const env = getRelevantRealm(browser.window).env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  return { browser, origin, env };
}
