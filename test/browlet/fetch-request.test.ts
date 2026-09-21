import { describe, expect, it, vi } from 'vitest';

import { getBindingContext, getRelevantRealm } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import type { FetchBody } from '../../src/fetch/body';
import type { FetchPromptTarget } from '../../src/fetch/infrastructure';
import { RequestImpl } from '../../src/fetch/request';
import { parseURL } from '../../src/url/url';

describe('Fetch Request construction', () => {
  it('constructs a request with independent headers, a signal, and the relevant client', () => {
    const window = createWindow();
    const request = new window.Request('https://example.test/path#fragment');
    expect(request).toMatchObject({
      url: 'https://example.test/path#fragment', method: 'GET', destination: '',
      referrer: 'about:client', referrerPolicy: '', mode: 'cors', credentials: 'same-origin',
      cache: 'default', redirect: 'follow', integrity: '', keepalive: false,
      body: null, bodyUsed: false,
    });
    expect(request.headers).toBeInstanceOf(window.Headers);
    expect(request.headers).toBe(request.headers);
    expect([...request.headers]).toEqual([]);
    expect(request.signal).toBeInstanceOf(window.AbortSignal);
    expect(request.signal).toBe(request.signal);
    expect(request.signal.aborted).toBe(false);
    const record = implementation(window, request).getRequest();
    expect(record.client).toBe(getRelevantRealm(window).hostDefined);
    expect(record.userAgent).toBe(getRelevantRealm(window).hostDefined!.userAgent);
    expect(record.unsafeRequest).toBe(true);
    expect(record.initiatorType).toBe('fetch');
    expect(Reflect.has(window, 'fetch')).toBe(false);
  });

  it('resolves URLs and referrers using the document API base URL', async () => {
    const browlet = new Browlet({ route: () => '' });
    await browlet.navigate('https://example.test/base/page');
    const window = browlet.window as Window & typeof globalThis;
    const request = new window.Request('resource', { referrer: '../from', referrerPolicy: 'origin' });
    expect(request.url).toBe('https://example.test/base/resource');
    expect(request.referrer).toBe('https://example.test/from');
    expect(request.referrerPolicy).toBe('origin');
    expect(new window.Request('resource', { referrer: '' }).referrer).toBe('');
    expect(new window.Request('resource', { referrer: 'about:client' }).referrer).toBe('about:client');
    expect(new window.Request('resource', { referrer: 'https://other.test/' }).referrer).toBe('about:client');
    expect(() => new window.Request('resource', { referrer: 'https://[' })).toThrow(window.TypeError);
  });

  it('uses the document base element when resolving Request URLs', async () => {
    const browlet = new Browlet({ route: () => '<base href="https://example.test/base/">' });
    await browlet.navigate('https://example.test/page');
    const window = browlet.window as Window & typeof globalThis;
    expect(new window.Request('resource').url).toBe('https://example.test/base/resource');
    const base = window.document.getElementsByTagName('base')[0]!;
    base.href = '/changed/';
    const request = new window.Request('resource', { referrer: 'from' });
    expect(request.url).toBe('https://example.test/changed/resource');
    expect(request.referrer).toBe('https://example.test/changed/from');
    base.remove();
    expect(new window.Request('resource').url).toBe('https://example.test/resource');
  });

  it('normalizes standard methods, retains extension methods, and converts options', () => {
    const window = createWindow();
    const request = new window.Request(url, {
      method: 'post', body: 'body', credentials: 'include', cache: 'no-store', redirect: 'manual',
      integrity: 'sha256-test', keepalive: true, referrerPolicy: 'no-referrer',
      headers: { 'X-Test': 'value', Cookie: 'forbidden' },
    });
    expect(request).toMatchObject({
      method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'manual',
      integrity: 'sha256-test', keepalive: true, referrerPolicy: 'no-referrer',
    });
    expect([...request.headers]).toEqual([['content-type', 'text/plain;charset=UTF-8'], ['x-test', 'value']]);
    expect(new window.Request(url, { method: 'patch' }).method).toBe('patch');
    expect(new window.Request(url, { mode: 'same-origin', cache: 'only-if-cached' }).cache).toBe('only-if-cached');
    expect(implementation(window, new window.Request(url, { window: null })).getRequest().traversableForUserPrompts)
      .toBeNull();
  });

  it.each([
    { method: '' }, { method: 'bad method' }, { method: 'CONNECT' }, { method: 'trace' }, { method: 'TRACK' },
    { mode: 'navigate' }, { cache: 'only-if-cached' }, { mode: 'no-cors', method: 'PUT' },
    { referrerPolicy: 'invalid' }, { signal: {} }, { window: {} },
  ])('rejects invalid constructor options %j', (init) => {
    const window = createWindow();
    expect(() => { Reflect.construct(window.Request, [url, init]); }).toThrow(window.TypeError);
  });

  it.each(['https://[', 'https://user:password@example.test/'])('rejects URL %s', (input) => {
    const window = createWindow();
    expect(() => new window.Request(input)).toThrow(window.TypeError);
  });

  it('applies the no-cors header guard during construction and later mutations', () => {
    const window = createWindow();
    const request = new window.Request(url, {
      mode: 'no-cors', method: 'POST', body: new window.Blob(['x'], { type: 'application/json' }),
      headers: { Accept: 'text/plain', 'X-Test': 'forbidden' },
    });
    expect([...request.headers]).toEqual([['accept', 'text/plain']]);
    request.headers.set('X-Test', 'still forbidden');
    request.headers.set('Content-Type', 'application/json');
    expect([...request.headers]).toEqual([['accept', 'text/plain']]);
    request.headers.set('Content-Type', 'text/plain');
    expect(request.headers.get('Content-Type')).toBe('text/plain');
    expect(() => new window.Request(url, { method: 'GET', body: '' })).toThrow(window.TypeError);
    expect(() => new window.Request(url, { method: 'HEAD', body: '' })).toThrow(window.TypeError);
  });

  it('copies request state without sharing headers and resets privileged state only for nonempty init', () => {
    const window = createWindow();
    const source = new window.Request(url, { headers: { 'X-Test': 'one' }, referrer: '', referrerPolicy: 'origin' });
    const record = implementation(window, source).getRequest();
    record.mode = 'navigate';
    record.reloadNavigation = true;
    record.historyNavigation = true;
    record.headerList.append('Cookie', 'privileged');
    record.urlList.push(parseURL('https://example.test/redirect').url!);
    const copy = new window.Request(source, { method: undefined, ignored: true } as RequestInit);
    expect(copy).toMatchObject({ url, mode: 'navigate', referrer: '', referrerPolicy: 'origin' });
    expect(copy.headers.get('Cookie')).toBe('privileged');
    expect(implementation(window, copy).getRequest()).toMatchObject({ reloadNavigation: true, historyNavigation: true });
    copy.headers.set('X-Test', 'two');
    expect(source.headers.get('X-Test')).toBe('one');

    const modified = new window.Request(source, { integrity: '' });
    expect(modified).toMatchObject({
      url: 'https://example.test/redirect', mode: 'same-origin', referrer: 'about:client', referrerPolicy: '',
    });
    expect(modified.headers.get('Cookie')).toBeNull();
    const modifiedRecord = implementation(window, modified).getRequest();
    expect(modifiedRecord).toMatchObject({ reloadNavigation: false, historyNavigation: false, origin: undefined });
    expect(modifiedRecord.urlList).toHaveLength(1);
  });

  it('retains a same-origin prompt target and lets window: null suppress it', () => {
    const window = createWindow();
    const source = new window.Request(url);
    const record = implementation(window, source).getRequest();
    const target: FetchPromptTarget = { origin: record.client!.origin };
    record.traversableForUserPrompts = target;

    const copy = new window.Request(source);
    expect(implementation(window, copy).getRequest().traversableForUserPrompts).toBe(target);
    expect(implementation(window, source.clone()).getRequest().traversableForUserPrompts).toBe(target);
    const suppressed = new window.Request(source, { window: null });
    expect(implementation(window, suppressed).getRequest().traversableForUserPrompts).toBeNull();
    expect(implementation(window, suppressed.clone()).getRequest().traversableForUserPrompts).toBeNull();
    expect(implementation(window, new window.Request(suppressed)).getRequest().traversableForUserPrompts)
      .toBeUndefined();
    expect(record.traversableForUserPrompts).toBe(target);
  });

  it('defers prompt selection when constructing a Request from a different origin', () => {
    const owner = createWindow();
    const other = createWindow();
    const source = new owner.Request(url);
    const record = implementation(owner, source).getRequest();
    const target: FetchPromptTarget = { origin: record.client!.origin };
    record.traversableForUserPrompts = target;

    const copy = new other.Request(source);
    expect(implementation(other, copy).getRequest().traversableForUserPrompts).toBeUndefined();
    expect(record.traversableForUserPrompts).toBe(target);
  });

  it('assigns a requested priority or updates an existing internal priority', () => {
    const window = createWindow();
    const request = Reflect.construct(window.Request, [url, { priority: 'high' }]);
    const record = implementation(window, request).getRequest();
    expect(record.priority).toBe('high');
    const update = vi.fn();
    record.internalPriority = { update };
    const copy = Reflect.construct(window.Request, [request, { priority: 'low' }]);
    expect(update).toHaveBeenCalledExactlyOnceWith('low');
    expect(implementation(window, copy).getRequest().internalPriority).toBe(record.internalPriority);
  });
});

describe('Fetch Request bodies and cloning', () => {
  it('transfers an input body through a proxy when constructing another Request', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(async () => {
      const input = new Request('https://example.test/', { method: 'POST', body: 'payload' });
      const original = input.body;
      const copy = new Request(input, { body: null });
      return {
        distinct: copy.body !== original,
        inputLocked: original!.locked, inputUsed: input.bodyUsed, copyUsed: copy.bodyUsed,
        text: await copy.text(),
      };
    })).toEqual({ distinct: true, inputLocked: true, inputUsed: true, copyUsed: false, text: 'payload' });
  });

  it('tees a cloned body and preserves header and abort-signal independence', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(async () => {
      const controller = new AbortController();
      const input = new Request('https://example.test/', { method: 'POST', body: 'payload', signal: controller.signal });
      const copy = input.clone();
      copy.headers.set('X-Test', 'copy');
      const before = [input.bodyUsed, copy.bodyUsed, input.body!.locked, copy.body!.locked];
      controller.abort('reason');
      return {
        before, bodies: await Promise.all([input.text(), copy.text()]),
        originalHeader: input.headers.get('X-Test'), distinctSignals: input.signal !== copy.signal,
        reasons: [input.signal.reason, copy.signal.reason],
      };
    })).toEqual({
      before: [false, false, false, false], bodies: ['payload', 'payload'],
      originalHeader: null, distinctSignals: true, reasons: ['reason', 'reason'],
    });
  });

  it('rejects locked and consumed input bodies, while allowing an explicit replacement', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(async () => {
      const input = new Request('https://example.test/', { method: 'POST', body: 'old' });
      const reader = input.body!.getReader();
      const rejected: boolean[] = [];
      for (const create of [() => new Request(input), () => input.clone()]) {
        try { create(); rejected.push(false); } catch (error) { rejected.push(error instanceof TypeError); }
      }
      reader.releaseLock();
      await input.text();
      for (const create of [() => new Request(input), () => input.clone()]) {
        try { create(); rejected.push(false); } catch (error) { rejected.push(error instanceof TypeError); }
      }
      const replacement = new Request(input, { body: 'new' });
      try { new Request(input, { method: 'GET' }); rejected.push(false); }
      catch (error) { rejected.push(error instanceof TypeError); }
      return { rejected, text: await replacement.text() };
    })).toEqual({ rejected: [true, true, true, true, true], text: 'new' });
  });

  it('requires duplex for supplied streams, forbids keepalive and no-cors, and marks preflight', () => {
    const window = createWindow();
    const body = new window.ReadableStream();
    const init = { method: 'POST', body, duplex: 'half' };
    expect(() => new window.Request(url, { method: 'POST', body })).toThrow(window.TypeError);
    expect(() => new window.Request(url, { ...init, keepalive: true })).toThrow(window.TypeError);
    expect(() => new window.Request(url, { ...init, mode: 'no-cors' })).toThrow(window.TypeError);
    const request = new window.Request(url, init);
    expect(request.body).toBe(body);
    expect(implementation(window, request).getRequest().useCORSPreflight).toBe(true);
    // Inheriting this body requires no second duplex option.
    expect(new window.Request(request).body).not.toBe(body);
  });
});

describe('Fetch Request signals and realm ownership', () => {
  it('creates dependent signals and retains the same abort reason throughout the graph', () => {
    const window = createWindow();
    const controller = new window.AbortController();
    const request = new window.Request(url, { signal: controller.signal });
    const copy = new window.Request(request);
    const detached = new window.Request(request, { signal: null });
    const observations: boolean[] = [];
    controller.signal.addEventListener('abort', () => observations.push(request.signal.aborted, copy.signal.aborted));
    const reason = {};
    controller.abort(reason);
    expect(request.signal).not.toBe(controller.signal);
    expect(copy.signal).not.toBe(request.signal);
    expect(request.signal.reason).toBe(reason);
    expect(copy.signal.reason).toBe(reason);
    expect(observations).toEqual([true, true]);
    expect(detached.signal.aborted).toBe(false);
    expect(new window.Request(url, { signal: controller.signal }).signal.reason).toBe(reason);
  });

  it('uses the new constructor realm for copied bodies and signals and the receiver realm for clones', () => {
    const owner = createWindow();
    const other = createWindow();
    const input = new owner.Request(url, { method: 'POST', body: 'payload' });
    const copy = new other.Request(input);
    expect(copy).toBeInstanceOf(other.Request);
    expect(copy.headers).toBeInstanceOf(other.Headers);
    expect(copy.signal).toBeInstanceOf(other.AbortSignal);
    expect(copy.body).toBeInstanceOf(other.ReadableStream);
    expect(implementation(owner, input).getRequest().userAgent).toBe(getRelevantRealm(owner).hostDefined!.userAgent);
    expect(implementation(other, copy).getRequest().userAgent).toBe(getRelevantRealm(other).hostDefined!.userAgent);
    const copyBody = implementation(other, copy).getRequest().body as FetchBody;
    expect(copyBody.stream.runtime).toBe(getBindingContext(getRelevantRealm(other)).getRuntime());
    const plain = new owner.Request(url);
    const clone = other.Request.prototype.clone.call(plain);
    expect(clone).toBeInstanceOf(owner.Request);
    expect(clone.headers).toBeInstanceOf(owner.Headers);
    expect(clone.signal).toBeInstanceOf(owner.AbortSignal);
    expect(implementation(owner, clone).getRequest().userAgent).toBe(getRelevantRealm(owner).hostDefined!.userAgent);
    expect(() => other.Request.prototype.clone.call({} as Request)).toThrow(other.TypeError);
  });

  it('supports subclass construction without giving clones the subclass prototype', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      class CustomRequest extends Request {}
      const request = new CustomRequest('https://example.test/');
      return {
        subclass: request instanceof CustomRequest, cloneSubclass: request.clone() instanceof CustomRequest,
        constructorLength: Request.length,
      };
    })).toEqual({ subclass: true, cloneSubclass: false, constructorLength: 1 });
  });
});

const url = 'https://example.test/start';

function createWindow(): Window & typeof globalThis {
  return new Browlet({ route: () => '' }).window as Window & typeof globalThis;
}

function implementation(window: Window, request: Request): RequestImpl {
  return getBindingContext(getRelevantRealm(window)).unwrap(request, RequestImpl)!;
}
