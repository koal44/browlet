import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { PageEvaluation } from '../../../src/browlet/automation/index';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('HTML event-handler processing', () => {
  it('invokes a Window error handler with all five error details and the public Window receiver', async () => {
    const browser = await createBrowser();
    expect(browser.window.onerror).toBeNull();
    expect(await browser.evaluate(() => {
      const failure = new Error('failure');
      const calls: unknown[][] = [];
      const handler = function(this: Window, message: string | Event, source?: string, line?: number, column?: number, error?: unknown) {
        calls.push([arguments.length, this === window, message, source, line, column, error === failure]);
        return true;
      };
      onerror = handler;
      const event = new ErrorEvent('error', {
        message: 'broken', filename: 'https://example.test/script.js', lineno: 12, colno: 7,
        error: failure, cancelable: true,
      });
      return [onerror === handler, dispatchEvent(event), event.defaultPrevented, calls];
    })).toEqual([true, false, true, [[5, true, 'broken', 'https://example.test/script.js', 12, 7, true]]]);
  });

  it('cancels special error events only for the boolean true result', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const results: unknown[] = [true, false, 1, 0, 'true', {}, null, undefined];
      return results.map((result) => {
        onerror = () => result;
        const cancelable = new ErrorEvent('error', { cancelable: true });
        const noncancelable = new ErrorEvent('error');
        return [dispatchEvent(cancelable), cancelable.defaultPrevented,
          dispatchEvent(noncancelable), noncancelable.defaultPrevented];
      });
    })).toEqual([
      [false, true, true, false],
      ...Array.from({ length: 7 }, () => [true, false, true, false]),
    ]);
  });

  it('uses ordinary handler arguments and cancellation outside the special error case', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const trace: unknown[][] = [];
      for (const result of [false, true]) {
        const event = new Event('error', { cancelable: true });
        onerror = function(first) {
          trace.push(['plain', arguments.length, first === event]);
          return result;
        };
        trace.push(['dispatch', dispatchEvent(event)]);

        const storage = new ErrorEvent('storage', { cancelable: true });
        onstorage = function(first) {
          trace.push(['type', arguments.length, Object.is(first, storage)]);
          return result;
        };
        trace.push(['dispatch', dispatchEvent(storage)]);

        const reader = new FileReader();
        const error = new ErrorEvent('error', { cancelable: true });
        reader.onerror = function(first) {
          trace.push(['target', arguments.length, Object.is(first, error)]);
          return result;
        };
        trace.push(['dispatch', reader.dispatchEvent(error)]);
      }
      return trace;
    })).toEqual([
      ['plain', 1, true], ['dispatch', false], ['type', 1, true], ['dispatch', false], ['target', 1, true], ['dispatch', false],
      ['plain', 1, true], ['dispatch', true], ['type', 1, true], ['dispatch', true], ['target', 1, true], ['dispatch', true],
    ]);
  });

  it('retains error-handler identity and listener position through object and null assignments', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const calls: string[] = [];
      const object = { handleEvent() { calls.push('object'); } };
      addEventListener('error', () => { calls.push('before'); });
      Reflect.set(window, 'onerror', object);
      const identity = Object.is(onerror, object);
      addEventListener('error', () => { calls.push('after'); });
      dispatchEvent(new ErrorEvent('error'));
      onerror = () => { calls.push('handler'); };
      dispatchEvent(new ErrorEvent('error'));
      Reflect.set(window, 'onerror', 1);
      const cleared = Object.is(onerror, null);
      onerror = () => { calls.push('readded'); };
      dispatchEvent(new ErrorEvent('error'));
      return [identity, cleared, calls];
    })).toEqual([true, true, ['before', 'after', 'before', 'handler', 'after', 'before', 'after', 'readded']]);
  });

  it('delivers reportError through onerror and exposes its cancellation to later listeners', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const error = new Error('reported');
      const calls: unknown[][] = [];
      onerror = function(message, _source, _line, _column, value) {
        calls.push(['handler', arguments.length, message, value === error]);
        return true;
      };
      addEventListener('error', (event) => {
        calls.push(['listener', event.defaultPrevented, event.error === error, event.isTrusted]);
      });
      reportError(error);
      return calls;
    })).toEqual([['handler', 5, 'Error: reported', true], ['listener', true, true, true]]);
  });

  it('keeps a borrowed error setter target-owned and reports thrown callbacks in their own realm', async () => {
    const target = await createBrowser();
    const source = createSibling(target);
    await source.evaluation.evaluate(() => {
      const failure = new Error('error handler failure');
      Reflect.set(globalThis, 'failure', failure);
      Reflect.set(globalThis, 'handler', function(message: string, ...details: unknown[]) {
        Reflect.set(globalThis, 'received', [message, details.length]);
        throw failure;
      });
    });
    const failures: unknown[] = [];
    source.window.addEventListener('error', (event) => {
      failures.push(Reflect.get(event, 'error'));
      event.preventDefault();
    });
    const callback: unknown = Reflect.get(source.window, 'handler');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow the setter with an explicit receiver below.
    const setter = Object.getOwnPropertyDescriptor(source.window, 'onerror')!.set!;
    Reflect.apply(setter, target.window, [callback]);
    const targetEnv = getRelevantRealm(target.window).env;
    const policy = vi.spyOn(targetEnv.userAgent, 'webDriverBiDiScriptingIsEnabled').mockReturnValue(false);
    const dispatch = () => target.window.dispatchEvent(new target.window.ErrorEvent('error', { message: 'outer', cancelable: true }));
    expect(dispatch()).toBe(true);
    expect(failures).toEqual([]);
    policy.mockReturnValue(true);

    const document = getRelevantRealm(source.window).env.window.document;
    const browsingContext = document.browsingContext;
    document.browsingContext = null;
    try {
      expect(dispatch()).toBe(true);
      expect(failures).toEqual([]);
    } finally {
      document.browsingContext = browsingContext;
    }

    const nextListener = vi.fn();
    target.window.addEventListener('error', nextListener);
    expect(dispatch()).toBe(true);
    expect(failures).toEqual([Reflect.get(source.window, 'failure')]);
    expect(Reflect.get(source.window, 'received')).toEqual(['outer', 4]);
    expect(target.window.onerror).toBe(callback);
    expect(nextListener).toHaveBeenCalledOnce();
  });

  it('retains a non-callable object without calling handleEvent or deactivating its listener', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      const object = { handleEvent: () => { trace.push('object'); } };
      Reflect.set(window, 'onstorage', object);
      const identity = Object.is(onstorage, object);
      addEventListener('storage', () => { trace.push('listener'); });
      dispatchEvent(new StorageEvent('storage'));
      onstorage = () => { trace.push('handler'); };
      dispatchEvent(new StorageEvent('storage'));
      return [identity, trace];
    })).toEqual([true, ['listener', 'handler', 'listener']]);
  });

  it('skips an inactive callback realm without clearing the handler or its listener position', async () => {
    const target = await createBrowser();
    const source = createSibling(target);
    await source.evaluation.evaluate(() => {
      const calls: string[] = [];
      Reflect.set(globalThis, 'calls', calls);
      Reflect.set(globalThis, 'handler', () => { calls.push('handler'); return false; });
    });
    const callback: unknown = Reflect.get(source.window, 'handler');
    const calls = Reflect.get(source.window, 'calls') as string[];
    target.window.addEventListener('storage', () => { calls.push('before'); });
    Reflect.set(target.window, 'onstorage', callback);
    target.window.addEventListener('storage', () => { calls.push('after'); });

    const sourceDocument = getRelevantRealm(source.window).env.window.document;
    const browsingContext = sourceDocument.browsingContext;
    sourceDocument.browsingContext = null;
    try {
      expect(target.window.dispatchEvent(new target.window.StorageEvent('storage', { cancelable: true }))).toBe(true);
      expect(calls).toEqual(['before', 'after']);
      expect(target.window.onstorage).toBe(callback);
    } finally {
      sourceDocument.browsingContext = browsingContext;
    }

    expect(target.window.dispatchEvent(new target.window.StorageEvent('storage', { cancelable: true }))).toBe(false);
    expect(calls).toEqual(['before', 'after', 'before', 'handler', 'after']);
  });

  it('uses the target environment for the BiDi gate, independently of the callback realm', async () => {
    const target = await createBrowser();
    const source = createSibling(target);
    await source.evaluation.evaluate(() => {
      const calls: boolean[] = [];
      Reflect.set(globalThis, 'calls', calls);
      Reflect.set(globalThis, 'handler', () => { calls.push(true); return false; });
    });
    const callback: unknown = Reflect.get(source.window, 'handler');
    const calls = Reflect.get(source.window, 'calls') as boolean[];
    const targetEnv = getRelevantRealm(target.window).env;
    const targetPolicy = vi.spyOn(targetEnv.userAgent, 'webDriverBiDiScriptingIsEnabled')
      .mockImplementation((env) => env !== targetEnv);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow the setter with an explicit receiver below.
    const setter = Object.getOwnPropertyDescriptor(source.window, 'onstorage')!.set!;
    Reflect.apply(setter, target.window, [callback]);

    expect(target.window.dispatchEvent(new target.window.StorageEvent('storage', { cancelable: true }))).toBe(true);
    expect(calls).toEqual([]);
    expect(targetPolicy).toHaveBeenCalledExactlyOnceWith(targetEnv);

    targetPolicy.mockReturnValue(true);
    expect(target.window.dispatchEvent(new target.window.StorageEvent('storage', { cancelable: true }))).toBe(false);
    expect(calls).toEqual([true]);
    expect(target.window.onstorage).toBe(callback);
    expect(targetPolicy.mock.calls).toEqual([[targetEnv], [targetEnv]]);
  });

  it('does not substitute the target document for the callback document activity check', async () => {
    const target = await createBrowser();
    const source = createSibling(target);
    await source.evaluation.evaluate(() => {
      Reflect.set(globalThis, 'handler', () => false);
    });
    const window = target.window;
    Reflect.set(window, 'onstorage', Reflect.get(source.window, 'handler'));
    const targetDocument = getRelevantRealm(window).env.window.document;
    const browsingContext = targetDocument.browsingContext;
    targetDocument.browsingContext = null;
    try {
      expect(window.dispatchEvent(new window.StorageEvent('storage', { cancelable: true }))).toBe(false);
    } finally {
      targetDocument.browsingContext = browsingContext;
    }
  });

  it('reports exceptions in the callback realm and continues the target listener list', async () => {
    const target = await createBrowser();
    const source = createSibling(target);
    await source.evaluation.evaluate(() => {
      const failure = new Error('handler failure');
      Reflect.set(globalThis, 'failure', failure);
      Reflect.set(globalThis, 'handler', function(this: Window, event: Event) {
        Reflect.set(globalThis, 'receiverMatches', this === event.currentTarget);
        throw failure;
      });
    });
    const failures: unknown[] = [];
    source.window.addEventListener('error', (event) => {
      failures.push(Reflect.get(event, 'error'));
      event.preventDefault();
    });
    const targetError = vi.fn();
    const nextListener = vi.fn();
    target.window.addEventListener('error', targetError);
    Reflect.set(target.window, 'onstorage', Reflect.get(source.window, 'handler'));
    target.window.addEventListener('storage', nextListener);

    expect(target.window.dispatchEvent(new target.window.StorageEvent('storage', { cancelable: true }))).toBe(true);
    expect(Reflect.get(source.window, 'receiverMatches')).toBe(true);
    expect(failures).toEqual([Reflect.get(source.window, 'failure')]);
    expect(targetError).not.toHaveBeenCalled();
    expect(nextListener).toHaveBeenCalledOnce();
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/');
  return browser;
}

function createSibling(browser: Browlet) {
  // Auxiliary browsing-context creation is unfinished. Compose two real Window
  // bindings in one agent, as same-origin script access requires.
  const sourceEnv = getRelevantRealm(browser.window).env;
  const env = sourceEnv.userAgent.createWindowEnvironment({
    agent: sourceEnv.realm.agent, userAgent: sourceEnv.userAgent,
    creationURL: sourceEnv.creationURL, origin: sourceEnv.origin, parent: null,
    topLevelCreationURL: sourceEnv.creationURL, topLevelOrigin: sourceEnv.origin,
  });
  const document = env.createDocument();
  document.origin = sourceEnv.origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  env.realm.windowProxy.setAssociatedWindow(env.realm.globalObject);
  const traversable = new TopLevelTraversable(createDocumentState(document));
  return { window: env.realm.windowProxy.platform, evaluation: new PageEvaluation(traversable) };
}
