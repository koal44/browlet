import { createServer, type RequestListener } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { PerformanceResourceTiming } from '../../../src/browlet/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from '../loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Fetch-produced Server Timing', () => {
  it('exposes repeated headers on the same resource entry delivered to observers', async () => {
    const { browser } = await fixture((_request, response) => {
      response.setHeader('Server-Timing', ['db;dur=2;desc="database, read"', 'db;dur=3']);
      response.end('metrics');
    });
    const result = await browser.evaluate(async () => {
      const delivered = new Promise<PerformanceResourceTiming>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          observer.disconnect();
          resolve(list.getEntries()[0] as PerformanceResourceTiming);
        });
        observer.observe({ type: 'resource' });
      });
      await (await fetch('/metrics')).text();
      const entry = await delivered;
      const retained = performance.getEntriesByType('resource')[0] as PerformanceResourceTiming;
      return {
        same: entry.serverTiming === retained.serverTiming,
        frozen: Object.isFrozen(entry.serverTiming),
        ownRealm: Object.getPrototypeOf(entry.serverTiming[0]) === PerformanceServerTiming.prototype,
        metrics: entry.serverTiming.map((metric) => metric.toJSON()),
      };
    });
    expect(result).toEqual({
      same: true, frozen: true, ownRealm: true,
      metrics: [
        { name: 'db', duration: 2, description: 'database, read' },
        { name: 'db', duration: 3, description: '' },
      ],
    });
  });

  it.each([
    ['cors', false], ['cors', true], ['no-cors', false], ['no-cors', true],
  ] as const)('uses TAO independently of response readability (%s, TAO=%s)', async (mode, tao) => {
    const foreign = await serverOrigin((_request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Server-Timing', 'db;dur=2');
      if (tao) response.setHeader('Timing-Allow-Origin', '*');
      // A null body reaches completion without relying on the unfinished opaque-body draining path.
      response.writeHead(204);
      response.end();
    });
    const { browser } = await fixture((_request, response) => response.end());
    const metrics = await browser.evaluate(async ({ url, mode }) => {
      const delivered = new Promise<PerformanceResourceTiming>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          observer.disconnect();
          resolve(list.getEntries()[0] as PerformanceResourceTiming);
        });
        observer.observe({ type: 'resource' });
      });
      await fetch(url, { mode });
      return (await delivered).serverTiming.map((metric) => metric.toJSON());
    }, { url: `${foreign}/metrics`, mode });
    expect(metrics).toEqual(tao ? [{ name: 'db', duration: 2, description: '' }] : []);
  });

  it('does not capture metrics for an insecure requesting global even when TAO permits them', async () => {
    const { browser, origin, env } = await fixture((_request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Timing-Allow-Origin', '*');
      response.setHeader('Server-Timing', 'db;dur=2');
      response.end('insecure');
    }, 'http://insecure.test/page');
    expect(env.isSecureContext).toBe(false);
    const metrics = await browser.evaluate(async (url) => {
      await (await fetch(url)).text();
      const entry = performance.getEntriesByType('resource')[0] as PerformanceResourceTiming;
      return entry.serverTiming.map((metric) => metric.toJSON());
    }, `${origin}/metrics`);
    expect(metrics).toEqual([]);
  });

  it.each([false, true])('exposes only the final response metrics and requires every redirect hop to pass TAO (%s)', async (redirectTAO) => {
    const foreign = await serverOrigin((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/target' || redirectTAO) response.setHeader('Timing-Allow-Origin', '*');
      if (request.url === '/redirect') {
        response.setHeader('Server-Timing', 'hop;dur=1');
        response.writeHead(302, { Location: '/target' });
        response.end();
      } else {
        response.setHeader('Server-Timing', 'final;dur=2');
        response.end('final');
      }
    });
    const { browser } = await fixture((_request, response) => response.end());
    const metrics = await browser.evaluate(async (url) => {
      await (await fetch(url)).text();
      const entry = performance.getEntriesByType('resource')[0] as PerformanceResourceTiming;
      return entry.serverTiming.map((metric) => metric.toJSON());
    }, `${foreign}/redirect`);
    expect(metrics).toEqual(redirectTAO ? [{ name: 'final', duration: 2, description: '' }] : []);
  });

  it('retains cached header metrics without making another request', async () => {
    let requests = 0;
    const { browser } = await fixture((_request, response) => {
      requests++;
      response.setHeader('Server-Timing', 'cached;dur=2');
      response.setHeader('Cache-Control', 'max-age=300');
      response.end('cached');
    });
    const result = await browser.evaluate(async () => {
      await (await fetch('/cache')).text();
      await (await fetch('/cache')).text();
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return {
        metrics: entries.map((entry) => entry.serverTiming.map((metric) => metric.toJSON())),
        distinctMetrics: entries[0]!.serverTiming[0] !== entries[1]!.serverTiming[0],
      };
    });
    expect(requests).toBe(1);
    expect(result).toEqual({
      metrics: [[{ name: 'cached', duration: 2, description: '' }], [{ name: 'cached', duration: 2, description: '' }]],
      distinctMetrics: true,
    });
  });
});

async function serverOrigin(listener: RequestListener) {
  const server = createServer(listener);
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  return origin;
}

async function fixture(listener: RequestListener, pageURL?: string) {
  const origin = await serverOrigin(listener);
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate(pageURL ?? `${origin}/page`);
  const env = getRelevantRealm(browser.window).env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  return { browser, origin, env };
}
