import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('HTML beforeunload event handlers', () => {
  it.each([false, true])('converts returns to nullable DOMString with cancelable=%s', async (cancelable) => {
    const browser = await createBrowser();
    expect(await browser.evaluate((cancelable: boolean) => {
      const values: unknown[] = [undefined, null, '', false, true, 0, 5, 'stay', { toString: () => 'object' }];
      return values.map((value) => {
        onbeforeunload = () => value;
        const event = document.createEvent('BeforeUnloadEvent');
        event.initEvent('beforeunload', false, cancelable);
        return [dispatchEvent(event), event.defaultPrevented, event.returnValue as unknown];
      });
    }, cancelable)).toEqual([
      [true, false, ''], [true, false, ''],
      ...['', 'false', 'true', '0', '5', 'stay', 'object'].map((value) => [!cancelable, cancelable, value]),
    ]);
  });

  it('retains callback identity and supplies one Event argument with the Window receiver', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      const calls: unknown[][] = [];
      const handler = function(this: Window, received: Event) {
        calls.push([arguments.length, received === event, this === window, window.event === event]);
        return 'stay';
      };
      onbeforeunload = handler;
      return [onbeforeunload === handler, dispatchEvent(event), calls, window.event === undefined];
    })).toEqual([true, false, [[1, true, true, true]], true]);
  });

  it('preserves nonempty returnValue after callback execution and result conversion', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      return ['earlier', 'callback', 'conversion'].map((phase) => {
        const event = document.createEvent('BeforeUnloadEvent');
        event.initEvent('beforeunload', false, true);
        if (phase === 'earlier') event.returnValue = phase;
        onbeforeunload = () => {
          if (phase === 'callback') event.returnValue = phase;
          return {
            toString() {
              if (phase === 'conversion') event.returnValue = phase;
              return 'result';
            },
          };
        };
        let observed: unknown;
        addEventListener('beforeunload', () => {
          observed = [event.defaultPrevented, event.returnValue];
        }, { once: true });
        return [dispatchEvent(event), event.returnValue as unknown, observed];
      });
    })).toEqual(['earlier', 'callback', 'conversion'].map((phase) => [false, phase, [true, phase]]));
  });

  it('keeps direct returnValue writes independent from cancellation', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      onbeforeunload = () => { event.returnValue = 'written'; };
      return [dispatchEvent(event), event.defaultPrevented, event.returnValue as unknown];
    })).toEqual([true, false, 'written']);
  });

  it('checks both the event interface and type after the declared return conversion', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      let conversions = 0;
      onbeforeunload = () => ({ toString() { conversions++; return 'stay'; } });
      const plain = new Event('beforeunload', { cancelable: true });
      const plainResult = dispatchEvent(plain);
      onbeforeunload = () => false;
      const falseResult = dispatchEvent(new Event('beforeunload', { cancelable: true }));
      const differentType = document.createEvent('BeforeUnloadEvent');
      differentType.initEvent('storage', false, true);
      onstorage = () => false;
      return [plainResult, plain.defaultPrevented, conversions, falseResult,
        dispatchEvent(differentType), differentType.defaultPrevented, differentType.returnValue as unknown];
    })).toEqual([true, false, 1, true, false, true, '']);
  });

  it('reports invocation and conversion errors once without canceling or stopping later listeners', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const failure = new Error('conversion failed');
      const reports: boolean[] = [];
      onerror = (_message, _source, _line, _column, error) => {
        reports.push(error === failure || error instanceof TypeError);
        return true;
      };
      let laterCalls = 0;
      onbeforeunload = () => { throw failure; };
      addEventListener('beforeunload', () => { laterCalls++; });
      const results = [
        () => { throw failure; },
        () => ({ toString() { throw failure; } }),
        () => Symbol('not a DOMString'),
      ].map((callback) => {
        onbeforeunload = callback;
        const event = document.createEvent('BeforeUnloadEvent');
        event.initEvent('beforeunload', false, true);
        return [dispatchEvent(event), event.defaultPrevented, event.returnValue as unknown];
      });
      return [results, reports, laterCalls, window.event === undefined];
    })).toEqual([Array.from({ length: 3 }, () => [true, false, '']), [true, true, true], 3, true]);
  });

  it('keeps legacy noncallable objects inert and clears primitives without moving replacements', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      const object = { toString() { trace.push('coerce object'); return 'stay'; } };
      addEventListener('beforeunload', () => { trace.push('before'); });
      Reflect.set(window, 'onbeforeunload', object);
      const identity = Object.is(onbeforeunload, object);
      addEventListener('beforeunload', () => { trace.push('after'); });
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      const inert = dispatchEvent(event);
      onbeforeunload = () => { trace.push('replacement'); return null; };
      dispatchEvent(event);
      Reflect.set(window, 'onbeforeunload', 5);
      const cleared = Object.is(onbeforeunload, null);
      onbeforeunload = () => { trace.push('readded'); return null; };
      dispatchEvent(event);
      return [identity, inert, cleared, trace];
    })).toEqual([true, true, true, ['before', 'after', 'before', 'replacement', 'after', 'before', 'after', 'readded']]);
  });

  it.each(['body', 'frameset'])('lazily compiles and clears the %s content handler through Window', async (tag) => {
    const browser = await createBrowser();
    const compile = vi.spyOn(getRelevantRealm(browser.window), 'compileFunction');
    const element = browser.document.createElement(tag);
    element.setAttribute('onbeforeunload', 'globalThis.receiverMatches = this === window; return false;');
    expect(compile).not.toHaveBeenCalled();
    const event = browser.document.createEvent('BeforeUnloadEvent');
    event.initEvent('beforeunload', false, true);
    expect(browser.window.dispatchEvent(event)).toBe(false);
    expect(event.returnValue).toBe('false');
    expect(Reflect.get(browser.window, 'receiverMatches')).toBe(true);
    const callback = browser.window.onbeforeunload;
    expect(callback).toBe(Reflect.get(element, 'onbeforeunload'));
    expect(callback?.name).toBe('onbeforeunload');
    expect(callback?.length).toBe(1);
    expect(compile).toHaveBeenCalledOnce();
    element.removeAttribute('onbeforeunload');
    expect(browser.window.onbeforeunload).toBeNull();
  });

  it('converts a handler supplied by the HTML parser', async () => {
    const browser = new Browlet({ route: () => '<body onbeforeunload="return 5;">', reporting: false });
    await browser.navigate('https://example.test/');
    expect(await browser.evaluate(() => {
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      return [dispatchEvent(event), event.returnValue as unknown];
    })).toEqual([false, '5']);
  });

  it('does not convert a result when scripting is disabled or the callback Document is inactive', async () => {
    const browser = await createBrowser();
    await browser.evaluate(() => {
      onbeforeunload = () => { throw new Error('must not invoke'); };
    });
    const env = getRelevantRealm(browser.window).env;
    const report = vi.spyOn(env.realm, 'reportException');
    const gate = vi.spyOn(env.userAgent, 'webDriverBiDiScriptingIsEnabled').mockReturnValue(false);
    const event = browser.document.createEvent('BeforeUnloadEvent');
    event.initEvent('beforeunload', false, true);
    expect(browser.window.dispatchEvent(event)).toBe(true);
    gate.mockRestore();
    const document = env.window.document;
    const window = browser.window;
    const browsingContext = document.browsingContext;
    document.browsingContext = null;
    try {
      expect(window.dispatchEvent(event)).toBe(true);
      expect(event.returnValue).toBe('');
      expect(report).not.toHaveBeenCalled();
    } finally {
      document.browsingContext = browsingContext;
    }
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/');
  return browser;
}
