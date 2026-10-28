import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { ErrorEvent as BrowletErrorEvent, Event as BrowletEvent } from '../../../src/browlet/platform';
import { ClassicScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { JSExecutionContext } from '../../../src/browlet/scripting/execution-context';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('runtime script errors', () => {
  it('dispatches a trusted, cancelable error event before reporting to the console', () => {
    const { window } = new Browlet({ route: () => '', reporting: false });
    const realm = getRelevantRealm(window);
    const exception = new realm.Error('failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listener = vi.fn((event: BrowletEvent) => { event.preventDefault(); });
    window.addEventListener('error', listener);

    realm.reportException(exception);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0]).toMatchObject({
      type: 'error', error: exception, isTrusted: true, cancelable: true,
    });
    expect(consoleError).not.toHaveBeenCalled();
    expect(realm.env.globalImplementation.inErrorReportingMode).toBe(false);
  });

  it('logs an unhandled exception after dispatch', () => {
    const { window } = browser();
    const exception = { failed: true };
    const order: string[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { order.push('console'); });
    window.addEventListener('error', () => { order.push('event'); });

    window.reportError(exception);

    expect(order).toEqual(['event', 'console']);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(exception);
  });

  it('reports a throwing error listener without recursively dispatching error events', () => {
    const { window } = browser();
    const realm = getRelevantRealm(window);
    const original = new realm.Error('original');
    const nested = new realm.Error('listener');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listener = vi.fn(() => {
      expect(realm.env.globalImplementation.inErrorReportingMode).toBe(true);
      throw nested;
    });
    window.addEventListener('error', listener);

    window.reportError(original);

    expect(listener).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls).toEqual([[nested], [original]]);
    expect(realm.env.globalImplementation.inErrorReportingMode).toBe(false);
  });

  it('omits the exception value without muting its message', () => {
    const { window } = browser();
    const realm = getRelevantRealm(window);
    const events = captureErrors(window);

    realm.env.reportException('visible message', true);

    expect(events[0]).toMatchObject({ message: 'visible message', error: null });
  });

  it('mutes a classic-script parse error without an evaluated script frame', () => {
    const { window } = browser();
    const env = getRelevantRealm(window).env;
    const events = captureErrors(window);
    const script = new ClassicScript('const =', env, env.apiBaseURL, new ScriptFetchOptions(), true);

    script.run();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      error: null, message: 'Script error.', filename: '', lineno: 0, colno: 0,
    });
    expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
  });

  it.each([false, true])('applies the running classic script\'s muted-errors flag (%s) to reportError', (muted) => {
    const { window } = browser();
    const realm = getRelevantRealm(window);
    const env = realm.env;
    const events = captureErrors(window);
    const script = new ClassicScript('', env, env.apiBaseURL, new ScriptFetchOptions(), muted);
    const context = new JSExecutionContext(realm);
    context.scriptOrModule = script.record;
    env.responsibleEventLoop.executionContextStack.push(context);
    try {
      window.reportError('private message');
    } finally {
      env.responsibleEventLoop.executionContextStack.pop();
    }

    expect(events[0]).toMatchObject({
      message: muted ? 'Script error.' : 'private message',
      error: muted ? null : 'private message',
    });
  });

  it('uses the receiver\'s global and event realm when reportError is borrowed', async () => {
    const first = browser();
    const second = browser();
    await first.navigate('https://example.test/first');
    await second.navigate('https://example.test/second');
    const firstEvents = captureErrors(first.window);
    const secondEvents = captureErrors(second.window);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- borrowing the method tests receiver ownership
    Reflect.apply(first.window.reportError, second.window, ['other global']);

    expect(firstEvents).toHaveLength(0);
    expect(secondEvents).toHaveLength(1);
    expect(getRelevantRealm(secondEvents[0]!)).toBe(getRelevantRealm(second.window));
  });

  it('keeps error-reporting mode separate for different globals', () => {
    const first = browser();
    const second = browser();
    const secondEvents = captureErrors(second.window);
    first.window.addEventListener('error', (event) => {
      event.preventDefault();
      second.window.reportError('second');
    });

    first.window.reportError('first');

    expect(secondEvents).toHaveLength(1);
    expect(secondEvents[0]!.error).toBe('second');
  });

  it('preserves values whose string conversion throws', () => {
    const { window } = browser();
    const events = captureErrors(window);
    const exception = { toString() { throw new Error('cannot stringify'); } };

    expect(() => window.reportError(exception)).not.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0]!.error).toBe(exception);
    expect(events[0]!.message.length).toBeGreaterThan(0);
  });

  it('exposes reportError to page code and accepts an explicit undefined value', async () => {
    const result = await browser().evaluate(() => {
      const errors: unknown[] = [];
      window.addEventListener('error', (event) => {
        event.preventDefault();
        errors.push(event.error);
      });
      const returned = reportError(undefined);
      let missingArgumentRejected = false;
      try { Reflect.apply(reportError, window, []); }
      catch (error) { missingArgumentRejected = error instanceof TypeError; }
      return { errors, returned, missingArgumentRejected };
    });

    expect(result).toEqual({ errors: [undefined], returned: undefined, missingArgumentRejected: true });
  });
});

describe('ErrorEvent', () => {
  it('supplies the specified defaults, including undefined error', async () => {
    const result = await browser().evaluate(() => {
      const event = new ErrorEvent('error');
      return {
        inheritsEvent: event instanceof Event,
        message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno,
        error: event.error as unknown, isTrusted: event.isTrusted, bubbles: event.bubbles, cancelable: event.cancelable,
      };
    });

    expect(result).toEqual({
      inheritsEvent: true, message: '', filename: '', lineno: 0, colno: 0,
      error: undefined, isTrusted: false, bubbles: false, cancelable: false,
    });
  });

  it('uses Web IDL conversion and preserves the supplied error identity', async () => {
    const result = await browser().evaluate(() => {
      const exception = { reason: 'failure' };
      const event = new ErrorEvent('error', {
        message: 'details', filename: '\uD800', lineno: -1, colno: 3.9,
        error: exception, bubbles: true, cancelable: true,
      });
      return {
        message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno,
        sameError: event.error === exception, bubbles: event.bubbles, cancelable: event.cancelable,
        writable: Reflect.set(event, 'message', 'replacement'),
      };
    });

    expect(result).toEqual({
      message: 'details', filename: '\uFFFD', lineno: 4294967295, colno: 3,
      sameError: true, bubbles: true, cancelable: true, writable: false,
    });
  });
});

function browser() {
  return new Browlet({ route: () => '', reporting: false });
}

function captureErrors(window: Browlet['window']): BrowletErrorEvent[] {
  const events: BrowletErrorEvent[] = [];
  window.addEventListener('error', (event) => {
    events.push(event as BrowletErrorEvent);
    event.preventDefault();
  });
  return events;
}
