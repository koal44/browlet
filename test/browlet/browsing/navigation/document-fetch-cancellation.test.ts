import { createServer, type RequestListener } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { fetch as fetchResource } from '../../../../src/fetch/fetch';
import { FetchRequest } from '../../../../src/fetch/request';
import { getRelevantRealm } from '../../../support/browlet-binding';
import { closeServer, listen } from '../../loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Document Fetch cancellation', () => {
  it('cancels the client request while a separate execution owner reads and delivers its body', async () => {
    let received = false;
    let closed = false;
    const { browser, document } = await fixture((_request, response) => {
      received = true;
      response.on('close', () => { closed = true; });
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('pending body');
    });
    const clientEnv = document.env;
    const env = clientEnv.userAgent.sandbox;
    const request = new FetchRequest(clientEnv.parseURL('/separate-owner', clientEnv.apiBaseURL)!, env);
    request.client = clientEnv;
    const response = vi.fn();
    const consumed = Promise.withResolvers<Uint8Array | null | 'failure'>();
    const controller = fetchResource(request, {
      useParallelQueue: true,
      processResponse: response,
      processResponseConsumeBody: (_response, bytes) => consumed.resolve(bytes),
    }, env);
    await expect.poll(() => response.mock.calls.length).toBe(1);
    expect(received).toBe(true);
    expect(clientEnv.fetchGroup.fetchRecords).toContainEqual({ request, controller });
    expect(env.fetchGroup.fetchRecords).not.toContainEqual({ request, controller });
    await browser.evaluate(() => window.stop());
    expect(await consumed.promise).toBe('failure');
    await expect.poll(() => closed).toBe(true);
    await expect.poll(() => request.done).toBe(true);
    expect(controller.state).toBe('terminated');
    expect(controller.hasPendingDelivery).toBe(false);
  });

  it.each(['headers', 'body'] as const)('stops an ordinary request during %s and permits a later fetch', async (phase) => {
    let received = false;
    let closed = false;
    const { browser, document } = await fixture((request, response) => {
      if (request.url === '/after') { response.end('after'); return; }
      received = true;
      response.on('close', () => { closed = true; });
      if (phase === 'body') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write('first');
      }
    });
    await browser.evaluate(() => {
      const result = { headers: false, error: '', ownTypeError: false, value: '' };
      (globalThis as unknown as CancellationPage).result = result;
      void fetch('/pending').then((response) => {
        result.headers = true;
        return response.text();
      }).then((value) => { result.value = value; }, (error: unknown) => {
        result.error = error instanceof Error ? error.name : 'unknown';
        result.ownTypeError = error instanceof TypeError;
      });
    });
    await expect.poll(() => received).toBe(true);
    if (phase === 'body') {
      await expect.poll(() => browser.evaluate(() => (globalThis as unknown as CancellationPage).result.headers)).toBe(true);
    }
    await browser.evaluate(() => window.stop());
    await expect.poll(() => browser.evaluate(() => (globalThis as unknown as CancellationPage).result.error)).toBe('TypeError');
    const state = await browser.evaluate(() => (globalThis as unknown as CancellationPage).result);
    expect(state.ownTypeError).toBe(true);
    expect(state.value).toBe('');
    await expect.poll(() => closed).toBe(true);
    expect(document.salvageable).toBe(false);
    expect([...document.bfcacheBlockingDetails]).toContainEqual({ reason: 'fetch' });
    await expect(browser.evaluate(async () => (await fetch('/after')).text())).resolves.toBe('after');
  });

  it.each(['network', 'data'] as const)('preserves a body read started after a %s fetch completes when stop runs', async (source) => {
    const { browser } = await fixture((_request, response) => response.end('complete'));
    await browser.evaluate(async (url) => {
      const response = await fetch(url);
      // Consuming the clone reaches EOF while retaining the original response's bytes.
      await response.clone().arrayBuffer();
      (globalThis as unknown as CompletedResponsePage).response = response;
    }, source === 'network' ? '/complete' : 'data:text/plain,complete');
    const result = await browser.evaluate(async () => {
      const { response } = globalThis as unknown as CompletedResponsePage;
      const pending = response.text();
      window.stop();
      try { return { value: await pending, error: '' }; }
      catch (error) { return { value: '', error: error instanceof Error ? error.name : 'unknown' }; }
    });
    expect(result).toEqual({ value: 'complete', error: '' });
  });

  it('permits stop from a completed response body promise continuation', async () => {
    const { browser } = await fixture((_request, response) => response.end('complete'));
    await expect(browser.evaluate(async () => {
      const response = await fetch('/complete');
      await response.clone().arrayBuffer();
      window.stop();
      return true;
    })).resolves.toBe(true);
  });

  it('does not deliver a successful response already queued when the Document aborts', async () => {
    let received = false;
    const { browser, document } = await fixture((_request, response) => {
      received = true;
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('obsolete');
    });
    const env = document.env;
    let stopped = false;
    vi.spyOn(env.userAgent, 'webDriverBiDiResponseCompleted').mockImplementation((_request, response) => {
      // Fetch has selected a successful response and queued its delivery at this hook.
      expect(response.status).toBe(200);
      stopped = true;
      document.abort();
    });
    const result = await browser.evaluate(async () => {
      try { return { status: (await fetch('/queued')).status, error: '' }; }
      catch (error) { return { status: 0, error: error instanceof Error ? error.name : 'unknown' }; }
    });
    expect(stopped).toBe(true);
    expect(received).toBe(true);
    expect(result).toEqual({ status: 0, error: 'TypeError' });
  });

  it.each(['abort', 'destroy'] as const)('discards completed bytes awaiting consumer delivery on %s after the request becomes done', async (operation) => {
    const { document } = await fixture((_request, response) => response.end());
    const env = document.env;
    const request = new FetchRequest(env.parseURL('data:text/plain,obsolete')!, env);
    request.client = env;
    const consumed = Promise.withResolvers<Uint8Array | null | 'failure'>();
    fetchResource(request, {
      processResponseEndOfBody: () => {
        expect(request.done).toBe(true);
        document[operation]();
      },
      processResponseConsumeBody: (_response, body) => consumed.resolve(body),
    }, env);
    expect(await consumed.promise).toBe('failure');
    expect([...document.bfcacheBlockingDetails]).toContainEqual({ reason: 'fetch' });
  });
});

async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browser = new Browlet({ route: () => '<!doctype html><body>fetch cancellation' });
  await browser.navigate(`${origin}/page`);
  const env = getRelevantRealm(browser.window).env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  return { browser, document: env.realm.getAssociatedDocument() };
}

type CancellationPage = {
  result: { headers: boolean; error: string; ownTypeError: boolean; value: string; };
};

type CompletedResponsePage = { response: Response; };
