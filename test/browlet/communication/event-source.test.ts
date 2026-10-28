import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../../src/browlet/environment';
import type { Event, EventSource, MessageEvent } from '../../../src/browlet/platform';
import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders } from '../../../src/fetch/headers';
import type { HTTPTransport, HTTPTransportListener, HTTPTransportRequest } from '../../../src/fetch/transport';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from '../loader/http-fixture';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

describe('EventSource (§9.2)', () => {
  it.each([false, true])('constructs a potential-CORS request with credentials %s', async (withCredentials) => {
    const f = await fixture();
    const source = new f.window.EventSource('../events?value=\ud800', { withCredentials });
    expect(source).toBeInstanceOf(f.window.EventTarget);
    expect(source.url).toBe('https://example.test/events?value=%EF%BF%BD');
    expect(source.withCredentials).toBe(withCredentials);
    expect(source.readyState).toBe(source.CONNECTING);
    expect([f.window.EventSource.CONNECTING, source.OPEN, source.CLOSED]).toEqual([0, 1, 2]);
    expect([source.onopen, source.onmessage, source.onerror]).toEqual([null, null, null]);
    const exchange = await f.exchange();
    const request = f.env.fetchGroup.fetchRecords.at(-1)!.request;
    expect(request).toMatchObject({
      mode: 'cors', credentialsMode: withCredentials ? 'include' : 'same-origin',
      cacheMode: 'no-store', initiatorType: 'other', destination: '', useURLCredentials: true,
    });
    expect(exchange.request.headers.get('Accept')).toBe('text/event-stream');
    expect(exchange.request.method).toBe('GET');
    expect(Reflect.set(source, 'url', 'changed')).toBe(false);
    expect(Reflect.set(source, 'withCredentials', !withCredentials)).toBe(false);
    expect(Reflect.set(source, 'readyState', source.OPEN)).toBe(false);
    source.close();
    expect(source.readyState).toBe(source.CLOSED);
    expect(exchange.abort).toHaveBeenCalledOnce();
    source.close();
    expect(exchange.abort).toHaveBeenCalledOnce();
  });

  it('rejects invalid URLs and converts constructor defaults before starting Fetch', async () => {
    const f = await fixture();
    expect(() => new f.window.EventSource('http://[')).toThrow(f.window.DOMException);
    try { new f.window.EventSource('http://['); }
    catch (error) { expect((error as DOMException).name).toBe('SyntaxError'); }
    expect(() => { Reflect.construct(f.window.EventSource, []); }).toThrow(Reflect.get(f.window, 'TypeError'));
    const source = new f.window.EventSource('/events');
    expect(source.withCredentials).toBe(false);
    source.close();
    expect(f.env.getWindowOrWorkerGlobalScopeMixin().eventSources.size).toBe(0);
  });

  it.each([false, true])('parses UTF-8, BOM, and CR/LF across chunks (bytewise: %s)', async (bytewise) => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    const events: MessageEvent[] = [];
    const order: string[] = [];
    source.onopen = function() {
      expect(this).toBe(source);
      order.push(`open:${source.readyState}`);
    };
    for (const type of ['message', 'update']) {
      source.addEventListener(type, (event) => {
        events.push(event as MessageEvent);
        order.push(type);
      });
    }
    source.addEventListener('error', () => { order.push(`error:${source.readyState}`); });
    const disconnected = once(source, 'error');
    const exchange = await f.exchange();
    exchange.respond(200, 'TEXT/EVENT-STREAM; charset=iso-8859-1');
    const bytes = utf8Encode(
      '\ufeff: comment\r\ndata: café🙂\r\ndata: second\rid: 会\nevent: update\r\n\r\n' +
      'data\rid: ignored\0id\r\r' +
      'event: discarded\n\nDATA: ignored\ndata:  padded\n\n' +
      'data: incomplete\n',
    );
    if (bytewise) for (const byte of bytes) exchange.listener.onData(Uint8Array.of(byte));
    else exchange.listener.onData(bytes);
    exchange.listener.onEnd();
    await disconnected;
    expect(order).toEqual(['open:1', 'update', 'message', 'message', 'error:0']);
    expect(events.map((event) => {
      const data: unknown = event.data;
      return [event.type, data, event.lastEventId];
    })).toEqual([
      ['update', 'café🙂\nsecond', '会'], ['message', '', '会'], ['message', ' padded', '会'],
    ]);
    for (const event of events) {
      expect(event).toBeInstanceOf(f.window.MessageEvent);
      expect(event.origin).toBe('https://example.test');
      expect(event.source).toBeNull();
      expect(event.ports).toEqual([]);
      expect(event.isTrusted).toBe(true);
      expect([event.bubbles, event.cancelable]).toEqual([false, false]);
    }
    expect(f.clock.pending()).toHaveLength(1);
  });

  it.each([
    ['data\n\ndata\ndata\n\ndata:', ['', '\n']],
    ['data: one\r\rdata: two\r\n\r\n', ['one', 'two']],
    ['\ufeff\ufeffdata: ignored\n\ndata: kept\n\n', ['kept']],
    ['data: no blank line\n', []],
  ])('interprets event boundaries in %j', async (text, expected) => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    const values: unknown[] = [];
    source.onmessage = (event) => { values.push((event as MessageEvent).data); };
    const disconnected = once(source, 'error');
    const exchange = await f.exchange();
    exchange.respond();
    exchange.send(text);
    exchange.listener.onEnd();
    await disconnected;
    expect(values).toEqual(expected);
  });

  it('replaces malformed UTF-8 while retaining a split valid scalar', async () => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    const message = once(source, 'message');
    const exchange = await f.exchange();
    exchange.respond();
    exchange.send('data: ');
    exchange.listener.onData(Uint8Array.of(0xff, 0xf0, 0x9f));
    exchange.listener.onData(Uint8Array.of(0x99, 0x82, 0xc3, 10, 10));
    expect(((await message) as MessageEvent).data).toBe('�🙂�');
  });

  it('keeps the specified retry deadline and sends then clears the UTF-8 Last-Event-ID', async () => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    let disconnected = once(source, 'error');
    const first = await f.exchange();
    first.respond();
    first.send('retry: 40\nid: 会\ndata: first\n\n');
    first.listener.onEnd();
    await disconnected;
    expect(f.clock.pending()[0]!.delay).toBe(40);
    // A host may wake early or clamp a long delay. Recheck the actual deadline.
    f.clock.wakeEarly();
    expect(f.clock.pending()[0]!.delay).toBe(40);
    f.clock.advance(39);
    expect(f.transport.exchanges).toHaveLength(1);
    f.clock.advance(1);
    const second = await f.exchange(2);
    expect(second.request.headers.get('Last-Event-ID')).toBe(Buffer.from('会').toString('latin1'));
    disconnected = once(source, 'error');
    second.respond();
    second.send('id\n\ndata: reset\n\nretry: 0\n');
    second.listener.onEnd();
    await disconnected;
    f.clock.advance(0);
    const third = await f.exchange(3);
    expect(third.request.headers.has('Last-Event-ID')).toBe(false);
    expect(source.url).toBe('https://example.test/events');
  });

  it('ignores retry fields that are not nonempty ASCII digits', async () => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    const disconnected = once(source, 'error');
    const exchange = await f.exchange();
    exchange.respond();
    exchange.send('retry: 17\nretry: -1\nretry: +2\nretry: 2.5\nretry: 9 \nretry\nretry: ١\n');
    exchange.listener.onEnd();
    await disconnected;
    expect(f.clock.pending()[0]!.delay).toBe(17);
  });

  it('retains the last dispatched ID across reconnects and ignores an unfinished ID update', async () => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    let disconnected = once(source, 'error');
    const first = await f.exchange();
    first.respond();
    first.send('retry: 0\nid: retained\ndata: first\n\n');
    first.listener.onEnd();
    await disconnected;
    f.clock.advance(0);
    const second = await f.exchange(2);
    const message = once(source, 'message');
    disconnected = once(source, 'error');
    second.respond();
    second.send('data: second\n\nid: unfinished\n');
    second.listener.onEnd();
    expect(((await message) as MessageEvent).lastEventId).toBe('retained');
    await disconnected;
    f.clock.advance(0);
    expect((await f.exchange(3)).request.headers.get('Last-Event-ID')).toBe('retained');
  });

  it.each([false, true])('uses Fetch CORS checks for a permitted remote stream (credentials: %s)', async (withCredentials) => {
    const f = await fixture();
    const source = new f.window.EventSource('https://other.test/events', { withCredentials });
    const message = once(source, 'message');
    const exchange = await f.exchange();
    expect(exchange.request.includeCredentials).toBe(withCredentials);
    exchange.respond(200, 'text/event-stream', [
      ['Access-Control-Allow-Origin', 'https://example.test'], ['Access-Control-Allow-Credentials', 'true'],
    ]);
    exchange.send('data: allowed\n\n');
    const event = await message as MessageEvent;
    expect(event.data).toBe('allowed');
    expect(event.origin).toBe('https://other.test');
  });

  it('does not expose a remote stream rejected by CORS', async () => {
    const f = await fixture();
    const source = new f.window.EventSource('https://other.test/events');
    const message = vi.fn();
    source.onmessage = message;
    const error = once(source, 'error');
    const exchange = await f.exchange();
    exchange.respond();
    exchange.send('data: private\n\n');
    exchange.listener.onEnd();
    await error;
    expect(message).not.toHaveBeenCalled();
    expect(source.readyState).toBe(source.CONNECTING);
  });

  it.each([[204, 'text/event-stream'], [500, 'text/event-stream'], [200, 'text/plain'], [200, null]])(
    'fails permanently for status %i with Content-Type %s', async (status, contentType) => {
      const f = await fixture();
      const source = new f.window.EventSource('/events');
      const opened = vi.fn();
      source.onopen = opened;
      const error = once(source, 'error');
      const exchange = await f.exchange();
      exchange.respond(status, contentType);
      const event = await error;
      expect(event).toBeInstanceOf(f.window.Event);
      expect(event.isTrusted).toBe(true);
      expect(source.readyState).toBe(source.CLOSED);
      expect(opened).not.toHaveBeenCalled();
      expect(f.clock.pending()).toEqual([]);
      expect(f.env.getWindowOrWorkerGlobalScopeMixin().eventSources.size).toBe(0);
    },
  );

  it.each([false, true])('reconnects after a network failure (after headers: %s)', async (afterHeaders) => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    const exchange = await f.exchange();
    if (afterHeaders) {
      const opened = once(source, 'open');
      exchange.respond();
      await opened;
    }
    const disconnected = once(source, 'error');
    exchange.listener.onError(new Error('Connection lost'));
    await disconnected;
    expect(source.readyState).toBe(source.CONNECTING);
    f.clock.advance(3000);
    await f.exchange(2);
  });

  it('treats an aborted network error as terminal', async () => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    await f.exchange();
    const error = once(source, 'error');
    f.env.fetchGroup.fetchRecords.at(-1)!.controller!.abort(f.env);
    await error;
    expect(source.readyState).toBe(source.CLOSED);
    expect(f.clock.pending()).toEqual([]);
  });

  it('drops queued messages and reconnect notifications when a message handler closes', async () => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    const values: unknown[] = [];
    const errors = vi.fn();
    source.onerror = errors;
    source.onmessage = (event) => {
      values.push((event as MessageEvent).data);
      source.close();
    };
    const received = once(source, 'message');
    const exchange = await f.exchange();
    exchange.respond();
    exchange.send('retry: 0\ndata: first\n\ndata: second\n\n');
    exchange.listener.onEnd();
    await received;
    await settleTasks(f.env);
    expect(values).toEqual(['first']);
    expect(errors).not.toHaveBeenCalled();
    expect(source.readyState).toBe(source.CLOSED);
    expect(f.clock.pending()).toEqual([]);
  });

  it('aborts an open connection and discards queued messages from an open handler', async () => {
    const f = await fixture();
    const source = new f.window.EventSource('/events');
    const message = vi.fn();
    source.onmessage = message;
    source.onopen = () => { source.close(); };
    const opened = once(source, 'open');
    const exchange = await f.exchange();
    exchange.respond();
    exchange.send('data: queued\n\n');
    await opened;
    await settleTasks(f.env);
    expect(message).not.toHaveBeenCalled();
    expect(exchange.abort).toHaveBeenCalledOnce();
  });

  it('closes all sources, including a pending retry, when their document is destroyed', async () => {
    const f = await fixture();
    const first = new f.window.EventSource('/first');
    const second = new f.window.EventSource('/second');
    const opened = once(first, 'open');
    const disconnected = once(second, 'error');
    const firstExchange = await f.exchange();
    firstExchange.respond();
    const secondExchange = await f.exchange(2);
    secondExchange.respond();
    secondExchange.listener.onEnd();
    await Promise.all([opened, disconnected]);
    expect(f.clock.pending()).toHaveLength(1);
    await new Promise<void>((resolve) => {
      f.env.queueTask('dom-manipulation', () => {
        f.env.getAssociatedDocument()!.destroy();
        resolve();
      });
    });
    expect([first.readyState, second.readyState]).toEqual([2, 2]);
    expect(firstExchange.abort).toHaveBeenCalledOnce();
    expect(f.clock.pending()).toEqual([]);
    expect(f.env.getWindowOrWorkerGlobalScopeMixin().eventSources.size).toBe(0);
  });

  it('uses real HTTP, follows redirects through Fetch, and reports the final response origin', async () => {
    const destination = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
      response.write('data: from the server\n\n');
    });
    const destinationOrigin = await listen(destination);
    cleanup.push(() => closeServer(destination));
    const server = createServer((_request, response) => {
      response.writeHead(307, { Location: `${destinationOrigin}/stream` }).end();
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = new Browlet({ route: () => '', reporting: false });
    await browser.navigate(`${origin}/page`);
    cleanup.push(() => getRelevantRealm(browser.window).env.userAgent.httpTransport.close());
    const result = await browser.evaluate((url) => new Promise((resolve, reject) => {
      const source = new EventSource(url);
      source.onmessage = (event) => {
        const data: unknown = event.data;
        resolve({ data, origin: event.origin, url: source.url, trusted: event.isTrusted });
        source.close();
      };
      source.onerror = () => { source.close(); reject(new Error('Unexpected EventSource failure')); };
    }), `${origin}/redirect`);
    expect(result).toEqual({
      data: 'from the server', origin: destinationOrigin, url: `${origin}/redirect`, trusted: true,
    });
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/base/page');
  const { window } = browser;
  const env = getRelevantRealm(window).env;
  const transport = new ControlledTransport();
  env.userAgent.httpTransport = transport;
  let now = 0;
  const timers: { at: number; delay: number; steps: () => void; canceled: boolean; }[] = [];
  vi.spyOn(env.userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => now);
  env.userAgent.timerHost = {
    scheduleTimeout(delay, steps) {
      const timer = { at: now + delay, delay, steps, canceled: false };
      timers.push(timer);
      return { remove() { timer.canceled = true; } };
    },
  };
  cleanup.push(() => {
    for (const source of env.getWindowOrWorkerGlobalScopeMixin().eventSources) source.close();
  });
  return {
    window, env, transport,
    async exchange(count = 1) {
      await expect.poll(() => transport.exchanges.length).toBeGreaterThanOrEqual(count);
      return transport.exchanges[count - 1]!;
    },
    clock: {
      pending: () => timers.filter((timer) => !timer.canceled),
      advance(milliseconds: number) {
        now += milliseconds;
        for (const timer of [...timers]) {
          if (timer.canceled || timer.at > now) continue;
          timer.canceled = true;
          timer.steps();
        }
      },
      wakeEarly() {
        const timer = timers.find((timer) => !timer.canceled)!;
        timer.canceled = true;
        timer.steps();
      },
    },
  };
}

function once(source: EventSource, type: string) {
  return new Promise<Event>((resolve) => {
    source.addEventListener(type, (event) => { resolve(event); }, { once: true });
  });
}

async function settleTasks(env: BrowletEnvironment): Promise<void> {
  await expect.poll(() => [...env.responsibleEventLoop.getTaskQueues()].every((queue) => queue.size === 0)).toBe(true);
}

class ControlledTransport implements HTTPTransport {
  exchanges: Exchange[] = [];
  dispatch(request: HTTPTransportRequest, listener: HTTPTransportListener) {
    const exchange = new Exchange(request, listener);
    this.exchanges.push(exchange);
    return exchange;
  }
  async close(): Promise<void> {}
}

class Exchange {
  request: HTTPTransportRequest;
  listener: HTTPTransportListener;
  pause = vi.fn();
  resume = vi.fn();
  abort = vi.fn();
  constructor(request: HTTPTransportRequest, listener: HTTPTransportListener) {
    this.request = request;
    this.listener = listener;
  }
  respond(status = 200, contentType: string | null = 'text/event-stream', fields: [string, string][] = []): void {
    const headers = new FetchHeaders();
    if (contentType !== null) headers.append('Content-Type', contentType);
    for (const [name, value] of fields) headers.append(name, value);
    this.listener.onHeaders(status, 'OK', headers, true);
  }
  send(text: string): void { this.listener.onData(utf8Encode(text)); }
}
