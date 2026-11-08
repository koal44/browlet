import { createServer, type RequestListener, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { CSPList } from '../../../../src/browlet/browsing/policy/csp/list';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { fetch as fetchResource } from '../../../../src/fetch/fetch';
import { FetchRequest } from '../../../../src/fetch/request';
import { FetchResponse } from '../../../../src/fetch/response';
import { getRelevantRealm } from '../../../support/browlet-binding';
import { closeServer, listen } from '../../loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Keepalive Fetch lifetime', () => {
  it.each(['headers', 'body'] as const)('retains response delivery through stop during %s', async (phase) => {
    let pending: ServerResponse | undefined;
    const { browser, document } = await fixture((_request, response) => {
      pending = response;
      if (phase === 'body') response.writeHead(200, { 'Content-Type': 'text/plain' }).write('first');
    });
    await browser.evaluate(() => {
      const page = globalThis as unknown as KeepalivePage;
      page.headers = false;
      page.result = fetch('/pending', { keepalive: true }).then(async (response) => {
        page.headers = true;
        const ownResponse = response instanceof Response;
        const ownStream = response.body instanceof ReadableStream;
        const reader = response.body!.getReader({ mode: 'byob' });
        let value = '';
        let ownChunks = true;
        while (true) {
          const chunk = await reader.read(new Uint8Array(3));
          if (chunk.done) break;
          ownChunks &&= chunk.value instanceof Uint8Array;
          value += new TextDecoder().decode(chunk.value);
        }
        return { value, ownResponse, ownStream, ownChunks };
      });
    });
    await expect.poll(() => pending !== undefined).toBe(true);
    if (phase === 'body') {
      await expect.poll(() => browser.evaluate(() => (globalThis as unknown as KeepalivePage).headers)).toBe(true);
    }
    const { request, controller } = document.env.fetchGroup.fetchRecords.at(-1)!;
    await browser.evaluate(() => window.stop());
    expect(controller!.state).toBe('ongoing');
    expect(controller!.responseDeliveryCanceled).toBe(false);
    pending!.end('last');
    await expect(browser.evaluate(async () => (globalThis as unknown as KeepalivePage).result)).resolves.toEqual({
      value: phase === 'body' ? 'firstlast' : 'last', ownResponse: true, ownStream: true, ownChunks: true,
    });
    await expect.poll(() => request.done).toBe(true);
    expect(controller!.hasPendingDelivery).toBe(false);
  });

  it('finishes a retained POST and its redirect after the Document is destroyed', async () => {
    let pending: ServerResponse | undefined;
    const received: { path: string; body: string; }[] = [];
    const { browser, document } = await fixture((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        received.push({ path: request.url!, body });
        if (request.url === '/start') pending = response;
        else response.end('finished');
      });
    });
    await browser.evaluate(() => {
      void fetch('/start', { method: 'POST', body: 'retained upload', keepalive: true })
        .then((response) => response.text()).catch(() => {});
    });
    await expect.poll(() => pending !== undefined).toBe(true);
    const { request } = document.env.fetchGroup.fetchRecords.at(-1)!;
    await inDocumentTask(document, () => document.destroy());
    pending!.writeHead(307, { Location: '/finish' }).end();
    await expect.poll(() => received).toEqual([
      { path: '/start', body: 'retained upload' },
      { path: '/finish', body: 'retained upload' },
    ]);
    await expect.poll(() => request.done).toBe(true);
  });

  it('sends an upload whose production has not run when its Document is destroyed', async () => {
    let received = '';
    const { document } = await fixture((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { received += chunk; });
      request.on('end', () => response.end('complete'));
    });
    const env = document.env;
    const request = new FetchRequest(env.parseURL('/upload', env.apiBaseURL)!, env);
    request.client = env;
    request.method = 'POST';
    request.body = new TextEncoder().encode('queued upload');
    request.keepalive = true;
    const response = vi.fn<(response: FetchResponse) => void>();
    await inDocumentTask(document, () => {
      fetchResource(request, { processResponse: response }, env);
      document.destroy();
    });
    await expect.poll(() => received).toBe('queued upload');
    await expect.poll(() => request.done).toBe(true);
    expect(response).toHaveBeenCalledOnce();
    expect(response.mock.calls[0]![0].type).toBe('error');
  });

  it('retires a pending page read and drains a response larger than the transport buffer', async () => {
    let pending: ServerResponse | undefined;
    const { document } = await fixture((_request, response) => {
      pending = response;
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('first');
    });
    const env = document.env;
    const request = new FetchRequest(env.parseURL('/body', env.apiBaseURL)!, env);
    request.client = env;
    request.keepalive = true;
    const response = Promise.withResolvers<FetchResponse>();
    const controller = fetchResource(request, { processResponse: response.resolve }, env);
    const body = (await response.promise).body!;
    const consumed = Promise.withResolvers<unknown>();
    body.readAll(() => consumed.resolve('unexpected success'), consumed.resolve);
    await inDocumentTask(document, () => document.destroy());
    expect((await consumed.promise as Error).name).toBe('TypeError');
    expect(controller.state).toBe('ongoing');
    expect(pending!.destroyed).toBe(false);
    pending!.end('x'.repeat(256 * 1024));
    await expect.poll(() => request.done).toBe(true);
    expect(controller.hasPendingDelivery).toBe(false);
  });

  it('still aborts transport when its author signal is aborted', async () => {
    let received = false;
    let closed = false;
    const { browser } = await fixture((_request, response) => {
      received = true;
      response.on('close', () => { closed = true; });
    });
    await browser.evaluate(() => {
      const page = globalThis as unknown as KeepalivePage;
      page.controller = new AbortController();
      page.aborted = fetch('/pending', { keepalive: true, signal: page.controller.signal })
        .then(() => 'unexpected success', (error: unknown) => error instanceof DOMException ? error.name : 'unexpected error');
    });
    await expect.poll(() => received).toBe(true);
    await browser.evaluate(() => (globalThis as unknown as KeepalivePage).controller.abort());
    await expect(browser.evaluate(async () => (globalThis as unknown as KeepalivePage).aborted)).resolves.toBe('AbortError');
    await expect.poll(() => closed).toBe(true);
  });

  it.each(['blob', 'form'] as const)('retains a %s upload and the client origin across a redirect after destruction', async (kind) => {
    let pending: ServerResponse | undefined;
    const received: { body: string; type: string; origin: string; }[] = [];
    const { browser, document } = await fixture((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        received.push({ body, type: request.headers['content-type']!, origin: request.headers.origin! });
        if (request.url === '/start') pending = response;
        else response.end('finished');
      });
    });
    await browser.evaluate((kind) => {
      const form = new FormData();
      form.append('field', 'original');
      form.append('file', new Blob(['file content'], { type: 'text/plain' }), 'sample.txt');
      const request = new Request('/start', {
        method: 'POST', body: kind === 'blob' ? new Blob(['blob content']) : form, keepalive: true,
      });
      const pending = fetch(request).then((response) => response.text());
      void pending.catch(() => {});
      (globalThis as unknown as KeepalivePage).used = request.bodyUsed;
      form.set('field', 'changed');
    }, kind);
    await expect.poll(() => pending !== undefined).toBe(true);
    expect(await browser.evaluate(() => (globalThis as unknown as KeepalivePage).used)).toBe(true);
    const { request } = document.env.fetchGroup.fetchRecords.at(-1)!;
    const origin = await browser.evaluate(() => location.origin);
    await inDocumentTask(document, () => document.destroy());
    pending!.writeHead(307, { Location: '/finish' }).end();
    await expect.poll(() => received.length).toBe(2);
    expect(received[1]).toEqual(received[0]);
    expect(received[0]!.origin).toBe(origin);
    expect(received[0]!.body).toContain(kind === 'blob' ? 'blob content' : 'original');
    expect(received[0]!.body).not.toContain('changed');
    await expect.poll(() => request.done).toBe(true);
  });

  it('keeps keepalive quota on the client and releases it at completion', async () => {
    let pending: ServerResponse | undefined;
    let received = 0;
    const { browser, document } = await fixture((request, response) => {
      request.resume();
      request.on('end', () => {
        if (++received === 1) pending = response;
        else response.end('finished');
      });
    });
    await browser.evaluate(() => {
      (globalThis as unknown as KeepalivePage).first = fetch('/pending', {
        method: 'POST', body: 'x'.repeat(40 * 1024), keepalive: true,
      }).then((response) => response.text());
    });
    await expect.poll(() => pending !== undefined).toBe(true);
    const { request } = document.env.fetchGroup.fetchRecords.at(-1)!;
    await expect(browser.evaluate(async () => {
      try {
        await fetch('/over-quota', { method: 'POST', body: 'x'.repeat(40 * 1024), keepalive: true });
        return false;
      } catch (error) { return error instanceof TypeError; }
    })).resolves.toBe(true);
    expect(received).toBe(1);
    pending!.end('first');
    await expect(browser.evaluate(async () => (globalThis as unknown as KeepalivePage).first)).resolves.toBe('first');
    await expect.poll(() => request.done).toBe(true);
    await expect(browser.evaluate(async () => (await fetch('/after', {
      method: 'POST', body: 'x'.repeat(40 * 1024), keepalive: true,
    })).text())).resolves.toBe('finished');
    expect(received).toBe(2);
  });

  it('drains an inaccessible opaque response through completion', async () => {
    const remote = await fixture((_request, response) => response.end('x'.repeat(256 * 1024)));
    const { browser, document } = await fixture((_request, response) => response.end());
    const result = await browser.evaluate(async (url) => {
      const response = await fetch(url, { keepalive: true, mode: 'no-cors' });
      return { type: response.type, status: response.status, body: response.body };
    }, `${remote.origin}/opaque`);
    expect(result).toEqual({ type: 'opaque', status: 0, body: null });
    const { request, controller } = document.env.fetchGroup.fetchRecords.at(-1)!;
    await expect.poll(() => request.done).toBe(true);
    expect(controller!.hasPendingDelivery).toBe(false);
  });

  it('cancels transport when the author cancels the delivered body', async () => {
    let closed = false;
    const { browser, document } = await fixture((_request, response) => {
      response.on('close', () => { closed = true; });
      response.writeHead(200, { 'Content-Type': 'text/plain' }).write('pending');
    });
    await browser.evaluate(async () => {
      const response = await fetch('/pending', { keepalive: true });
      const reader = response.body!.getReader();
      const pending = reader.read();
      await reader.cancel('finished');
      await pending;
    });
    await expect.poll(() => closed).toBe(true);
    const { request, controller } = document.env.fetchGroup.fetchRecords.at(-1)!;
    await expect.poll(() => request.done).toBe(true);
    expect(controller!.hasPendingDelivery).toBe(false);
  });

  it('retains already-completed response bytes after destruction', async () => {
    const { document } = await fixture((_request, response) => response.end('complete'));
    const env = document.env;
    const request = new FetchRequest(env.parseURL('/complete', env.apiBaseURL)!, env);
    request.client = env;
    request.keepalive = true;
    const received = Promise.withResolvers<FetchResponse>();
    fetchResource(request, { processResponse: received.resolve }, env);
    const response = await received.promise;
    const completed = Promise.withResolvers<Uint8Array>();
    response.clone().body!.readAll(completed.resolve, () => completed.resolve(new Uint8Array()));
    expect(new TextDecoder().decode(await completed.promise)).toBe('complete');
    await expect.poll(() => request.done).toBe(true);
    await inDocumentTask(document, () => document.destroy());
    const retained = Promise.withResolvers<Uint8Array>();
    response.body!.readAll(retained.resolve, () => retained.resolve(new Uint8Array()));
    expect(new TextDecoder().decode(await retained.promise)).toBe('complete');
  });

  it.each(['browser execution', 'body callback'] as const)('finishes after destruction discards %s delivery', async (kind) => {
    let pending: ServerResponse | undefined;
    const { document } = await fixture((_request, response) => { pending = response; });
    const clientEnv = document.env;
    const env = kind === 'browser execution' ? clientEnv.userAgent.sandbox : clientEnv;
    const request = new FetchRequest(clientEnv.parseURL('/pending', clientEnv.apiBaseURL)!, env);
    request.client = clientEnv;
    request.keepalive = true;
    const response = vi.fn<(response: FetchResponse) => void>();
    const consumed = vi.fn<(response: FetchResponse, bytes: Uint8Array | null | 'failure') => void>();
    fetchResource(request, {
      processResponse: response,
      processResponseConsumeBody: kind === 'body callback' ? consumed : null,
    }, env);
    await expect.poll(() => pending !== undefined).toBe(true);
    await inDocumentTask(document, () => document.destroy());
    pending!.end('x'.repeat(256 * 1024));
    await expect.poll(() => request.done).toBe(true);
    expect(response).toHaveBeenCalledOnce();
    expect(response.mock.calls[0]![0].type).toBe('error');
    if (kind === 'body callback') {
      expect(consumed).toHaveBeenCalledOnce();
      expect(consumed.mock.calls[0]![1]).toBe('failure');
    }
  });

  it('realizes a failed response read in the response owner’s realm', async () => {
    let pending: ServerResponse | undefined;
    const { browser } = await fixture((_request, response) => {
      pending = response;
      response.writeHead(200, { 'Content-Type': 'text/plain' }).write('prefix');
    });
    await browser.evaluate(() => {
      const page = globalThis as unknown as KeepalivePage;
      page.headers = false;
      page.failure = fetch('/broken', { keepalive: true }).then(async (response) => {
        page.headers = true;
        try { await response.text(); return false; }
        catch (error) { return error instanceof TypeError; }
      });
    });
    await expect.poll(() => browser.evaluate(() => (globalThis as unknown as KeepalivePage).headers)).toBe(true);
    pending!.destroy();
    await expect(browser.evaluate(async () => (globalThis as unknown as KeepalivePage).failure)).resolves.toBe(true);
  });

  it('still enforces the original client policy on a redirect after destruction', async () => {
    let foreignRequests = 0;
    const remote = await fixture((_request, response) => { foreignRequests++; response.end('forbidden'); });
    let pending: ServerResponse | undefined;
    const { browser, document } = await fixture((_request, response) => { pending = response; });
    const response = new FetchResponse();
    response.urlList.push(document.env.apiBaseURL);
    response.headerList.append('Content-Security-Policy', "connect-src 'self'");
    document.policyContainer.cspList = CSPList.parse(response);
    await browser.evaluate(() => { void fetch('/start', { keepalive: true }).catch(() => {}); });
    await expect.poll(() => pending !== undefined).toBe(true);
    const { request } = document.env.fetchGroup.fetchRecords.at(-1)!;
    await inDocumentTask(document, () => document.destroy());
    pending!.writeHead(302, { Location: `${remote.origin}/forbidden` }).end();
    await expect.poll(() => request.done).toBe(true);
    expect(foreignRequests).toBe(0);
  });
});

async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browser = new Browlet({ route: () => '<!doctype html><body>keepalive' });
  await browser.navigate(`${origin}/page`);
  const env = getRelevantRealm(browser.window).env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  return { browser, document: env.realm.getAssociatedDocument(), origin };
}

type KeepalivePage = {
  headers: boolean;
  result: Promise<{ value: string; ownResponse: boolean; ownStream: boolean; ownChunks: boolean; }>;
  controller: AbortController;
  aborted: Promise<string>;
  used: boolean;
  first: Promise<string>;
  failure: Promise<boolean>;
};

function inDocumentTask(document: DocumentImpl, steps: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => document.env.queueTask('navigation-and-traversal', {
    run: () => {
      try { steps(); resolve(); }
      catch (cause) { reject(new Error('Document task failed', { cause })); }
    },
  }));
}
