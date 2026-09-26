import { createServer, type RequestListener, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { createDocument, createWindowEnvironment, getRelevantRealm, retargetWindowProxy } from '../../src/browlet/bindings';
import { BrowsingContext } from '../../src/browlet/browsing/browsing-context';
import type { WindowProxy } from '../../src/browlet/browsing/window/window-proxy';
import { closeServer, listen } from './loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Public fetch requests and responses', () => {
  it('returns realm-owned promises, responses, headers, streams, and bytes', async () => {
    const { browlet, origin } = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain', 'X-Visible': 'yes', 'Set-Cookie': 'secret=value' });
      response.end('hello');
    });
    expect(await browlet.evaluate(async () => {
      const p = fetch('/resource');
      const response = await p;
      let immutable = false;
      try { response.headers.set('X-Changed', 'no'); } catch (error) { immutable = error instanceof TypeError; }
      const stream = response.body;
      const bytes = await response.bytes();
      return {
        name: fetch.name, length: fetch.length, promise: p instanceof Promise,
        response: response instanceof Response, headers: response.headers instanceof Headers,
        stream: stream instanceof ReadableStream, bytes: bytes instanceof Uint8Array,
        type: response.type, status: response.status, url: response.url,
        visible: response.headers.get('X-Visible'), cookie: response.headers.get('Set-Cookie'),
        immutable, bodyUsed: response.bodyUsed, text: new TextDecoder().decode(bytes),
      };
    })).toEqual({
      name: 'fetch', length: 1, promise: true, response: true, headers: true, stream: true, bytes: true,
      type: 'basic', status: 200, url: `${origin}/resource`, visible: 'yes', cookie: null,
      immutable: true, bodyUsed: true, text: 'hello',
    });
  });

  it('transfers a Request body into fetch and prevents reuse', async () => {
    const { browlet } = await fixture((request, response) => request.pipe(response));
    expect(await browlet.evaluate(async () => {
      const request = new Request('/echo', { method: 'POST', body: 'payload' });
      const response = await fetch(request);
      let rejected = false;
      try { await fetch(request); } catch (error) { rejected = error instanceof TypeError; }
      return [await response.text(), request.bodyUsed, rejected];
    })).toEqual(['payload', true, true]);
  });

  it('resolves at headers and reads the body as it arrives', async () => {
    const pending = Promise.withResolvers<ServerResponse>();
    const { browlet } = await fixture((_request, response) => {
      response.writeHead(200); response.flushHeaders(); pending.resolve(response);
    });
    expect(await browlet.evaluate(async () => {
      const response = await fetch('/stream');
      (globalThis as unknown as FetchPage).reader = response.body!.getReader();
      return response.status;
    })).toBe(200);
    const response = await pending.promise;
    const read = browlet.evaluate(async () => {
      const { value, done } = await (globalThis as unknown as FetchPage).reader.read();
      return [new TextDecoder().decode(value), done];
    });
    response.write('first');
    expect(await read).toEqual(['first', false]);
    const final = browlet.evaluate(() => (globalThis as unknown as FetchPage).reader.read().then(({ done }) => done));
    response.end();
    expect(await final).toBe(true);
  });

  it('follows redirects, exposes manual redirects opaquely, and rejects redirect errors', async () => {
    const { browlet } = await fixture((request, response) => {
      if (request.url === '/redirect') response.writeHead(302, { Location: '/final' });
      response.end('final body');
    });
    expect(await browlet.evaluate(async () => {
      const followed = await fetch('/redirect');
      const manual = await fetch('/redirect', { redirect: 'manual' });
      let rejected = false;
      try { await fetch('/redirect', { redirect: 'error' }); } catch (error) { rejected = error instanceof TypeError; }
      return [followed.redirected, await followed.text(), manual.type, manual.status, manual.body, [...manual.headers], rejected];
    })).toEqual([true, 'final body', 'opaqueredirect', 0, null, [], true]);
  });

  it('applies CORS filtering and returns opaque no-cors responses', async () => {
    const { origin } = await fixture((_request, response) => {
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Visible',
        'X-Visible': 'yes', 'X-Hidden': 'no',
      });
      response.end('cross origin');
    });
    const { browlet } = await fixture((_request, response) => response.end());
    expect(await browlet.evaluate(async (origin) => {
      const response = await fetch(`${origin}/cors`);
      const opaque = await fetch(`${origin}/opaque`, { mode: 'no-cors' });
      return [response.type, response.headers.get('X-Visible'), response.headers.get('X-Hidden'), await response.text(),
        opaque.type, opaque.status, opaque.body, [...opaque.headers]];
    }, origin)).toEqual(['cors', 'yes', null, 'cross origin', 'opaque', 0, null, []]);
  });

  it('preserves HTTP error statuses while rejecting network failures', async () => {
    const { browlet } = await fixture((request, response) => {
      if (request.url === '/disconnect') { response.destroy(); return; }
      response.writeHead(404); response.end('missing');
    });
    expect(await browlet.evaluate(async () => {
      const response = await fetch('/missing');
      let networkError = false;
      try { await fetch('/disconnect'); } catch (error) { networkError = error instanceof TypeError; }
      return [response.status, response.ok, await response.text(), networkError];
    })).toEqual([404, false, 'missing', true]);
  });
});

describe('Public fetch binding and realm ownership', () => {
  it('uses the initial Request implementation and returns a fresh promise on every call', async () => {
    const { browlet } = await fixture((_request, response) => response.end('hello'));
    expect(await browlet.evaluate(async () => {
      Reflect.set(globalThis, 'Request', () => { throw new Error('replaced constructor'); });
      const first = fetch('/one');
      const second = fetch('/two');
      const responses = await Promise.all([first, second]);
      return [first !== second, ...await Promise.all(responses.map((response) => response.text()))];
    })).toEqual([true, 'hello', 'hello']);
  });

  it('keeps a borrowed fetch bound to the receiver environment', async () => {
    const { browlet, origin } = await fixture((request, response) => response.end(request.url));
    Reflect.set(browlet.window, 'otherWindow', createRelatedWindow(browlet.window));
    expect(await browlet.evaluate(async () => {
      const { otherWindow } = globalThis as unknown as FetchPage;
      const p = otherWindow.fetch.call(window, 'borrowed');
      const response = await p;
      return [p instanceof Promise, p instanceof otherWindow.Promise, response instanceof Response,
        response instanceof otherWindow.Response, response.url, await response.text()];
    })).toEqual([true, false, true, false, `${origin}/borrowed`, '/borrowed']);
  });

  it.each<[string, unknown[], boolean]>([
    ['missing request', [], false],
    ['invalid URL', ['https://['], false],
    ['forbidden method', ['/test', { method: 'CONNECT' }], false],
    ['invalid mode', ['/test', { mode: 'invalid' }], false],
    ['invalid receiver', ['/test'], true],
  ])('rejects rather than throwing for %s', async (_name, args, invalidReceiver) => {
    const { browlet } = await fixture((_request, response) => response.end());
    expect(await browlet.evaluate(async ({ args, invalidReceiver }) => {
      let p: Promise<Response>;
      try { p = Reflect.apply(fetch, invalidReceiver ? {} : window, args) as Promise<Response>; }
      catch { return 'threw synchronously'; }
      try { await p; return 'fulfilled'; }
      catch (error) { return [p instanceof Promise, error instanceof TypeError]; }
    }, { args, invalidReceiver })).toEqual([true, true]);
  });

  it('rejects borrowed Request-construction failures in the method realm', async () => {
    const { browlet } = await fixture((_request, response) => response.end());
    Reflect.set(browlet.window, 'otherWindow', createRelatedWindow(browlet.window));
    expect(await browlet.evaluate(async () => {
      const { otherWindow } = globalThis as unknown as FetchPage;
      const p = otherWindow.fetch.call(window, 'https://[');
      try { await p; return false; }
      catch (error) { return [p instanceof otherWindow.Promise, error instanceof otherWindow.TypeError]; }
    })).toEqual([true, true]);
  });
});

describe('Public fetch cancellation and lifetime', () => {
  it.each(['before fetch', 'after fetch'])('preserves the local abort reason %s without sending a request', async (when) => {
    let received = 0;
    const { browlet } = await fixture((_request, response) => { received++; response.end(); });
    expect(await browlet.evaluate(async (when) => {
      const controller = new AbortController();
      const reason = { message: 'stop', function() {} };
      if (when === 'before fetch') controller.abort(reason);
      const p = fetch('/aborted', { signal: controller.signal });
      if (when === 'after fetch') controller.abort(reason);
      try { await p; return false; } catch (error) { return error === reason; }
    }, when)).toBe(true);
    expect(received).toBe(0);
  });

  it('cancels a pre-aborted request body with the original reason', async () => {
    const { browlet } = await fixture((_request, response) => response.end());
    expect(await browlet.evaluate(async () => {
      const reason = { stop: true };
      let canceled: unknown;
      const body = new ReadableStream({ cancel(value) { canceled = value; } });
      try {
        const init = { method: 'POST', body, duplex: 'half', signal: AbortSignal.abort(reason) };
        await fetch('/aborted', init);
      } catch (error) { return [error === reason, canceled === reason]; }
    })).toEqual([true, true]);
  });

  it('aborts an in-flight response body with the original local reason', async () => {
    const closed = Promise.withResolvers<void>();
    const { browlet } = await fixture((_request, response) => {
      response.on('close', () => closed.resolve()); response.write('first');
    });
    expect(await browlet.evaluate(async () => {
      const controller = new AbortController();
      const reason = { stop: true, function() {} };
      const response = await fetch('/stream', { signal: controller.signal });
      const reader = response.body!.getReader();
      await reader.read();
      const pending = reader.read();
      controller.abort(reason);
      try { await pending; return false; } catch (error) { return error === reason; }
    })).toBe(true);
    await closed.promise;
  });

  it('keeps abort effective for an unread local body after fetch resolves', async () => {
    const { browlet } = await fixture((_request, response) => response.end());
    expect(await browlet.evaluate(async () => {
      const controller = new AbortController();
      const response = await fetch('data:text/plain,buffered', { signal: controller.signal });
      const reason = { stop: true };
      controller.abort(reason);
      try { await response.text(); return false; } catch (error) { return error === reason; }
    })).toBe(true);
  });

  it('deserializes controller aborts into the request realm', async () => {
    const received = Promise.withResolvers<void>();
    const { browlet, env } = await fixture(() => received.resolve());
    const result = browlet.evaluate(() => fetch('/pending').catch((error: Error) =>
      [error instanceof DOMException, error.name]));
    await received.promise;
    const record = env.fetchGroup.fetchRecords.find(({ request }) => !request.done)!;
    record.controller!.abort(env);
    expect(await result).toEqual([true, 'AbortError']);
  });

  it('keeps the network alive while only a body reader and its closed promise remain observable', async () => {
    const pending = Promise.withResolvers<ServerResponse>();
    const { browlet } = await fixture((_request, response) => {
      response.writeHead(200); response.flushHeaders(); pending.resolve(response);
    });
    await browlet.evaluate(async () => {
      const response = await fetch('/observable');
      const page = globalThis as unknown as FetchPage;
      page.reader = response.body!.getReader(); page.readerClosed = page.reader.closed;
    });
    const result = browlet.evaluate(async () => {
      const { reader, readerClosed } = globalThis as unknown as FetchPage;
      const { value } = await reader.read();
      await reader.read();
      await readerClosed;
      return new TextDecoder().decode(value);
    });
    (await pending.promise).end('still observed');
    expect(await result).toBe('still observed');
  });

  it('cancels the network when the response body is canceled', async () => {
    const closed = Promise.withResolvers<void>();
    const { browlet } = await fixture((_request, response) => {
      response.on('close', () => closed.resolve()); response.write('first');
    });
    expect(await browlet.evaluate(async () => {
      const response = await fetch('/stream');
      await response.body!.cancel(); return response.bodyUsed;
    })).toBe(true);
    await closed.promise;
  });

  it('rejects pending requests and body readers when the browser shuts down its transport', async () => {
    const pending = Promise.withResolvers<void>();
    const { browlet, env } = await fixture((request, response) => {
      if (request.url === '/pending') pending.resolve();
      else response.write('first');
    });
    await browlet.evaluate(async () => {
      const response = await fetch('/body');
      const page = globalThis as unknown as FetchPage;
      page.reader = response.body!.getReader(); await page.reader.read();
    });
    const results = browlet.evaluate(() => {
      const { reader } = globalThis as unknown as FetchPage;
      return Promise.all([
        fetch('/pending').catch((error) => error instanceof TypeError),
        reader.read().catch((error) => error instanceof TypeError),
        reader.closed.catch((error) => error instanceof TypeError),
      ]);
    });
    await pending.promise;
    await env.userAgent.httpTransport.close();
    expect(await results).toEqual([true, true, true]);
  });
});

async function fixture(listener: RequestListener) {
  const server = createServer(listener);
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '' });
  await browlet.navigate(`${origin}/page`);
  const env = getRelevantRealm(browlet.window).env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  return { browlet, origin, env };
}

function createRelatedWindow(first: Window): WindowProxy {
  // Same-origin related Windows share an agent and its microtask queue.
  const { agent, env } = getRelevantRealm(first);
  const creationURL = env.parseURL('/method/page', env.apiBaseURL).url!;
  const { window, realm } = createWindowEnvironment({
    agent, userAgent: env.userAgent, creationURL, origin: env.origin, parent: null,
    topLevelCreationURL: creationURL, topLevelOrigin: env.origin,
  });
  const proxy = realm.globalThis as WindowProxy;
  const document = createDocument(realm);
  document.browsingContext = new BrowsingContext(proxy);
  document.url = creationURL;
  window.setAssociatedDocument(document);
  retargetWindowProxy(proxy, window);
  return proxy;
}

interface FetchPage {
  otherWindow: typeof globalThis;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  readerClosed: Promise<void>;
}
