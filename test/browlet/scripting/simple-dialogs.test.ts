import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualUserAgent } from '../../support/browlet-agent';
import { unwrap } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';
import { runInHostTask } from '../../support/tasks';

describe('HTML simple dialogs: alert()', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const window = document.getRelevantGlobalObject()!;
    const env = document.env;
    return {
      browser, document, window, env,
      opened: vi.spyOn(env.userAgent, 'webDriverBiDiUserPromptOpened').mockReturnValue('accept'),
      closed: vi.spyOn(env.userAgent, 'webDriverBiDiUserPromptClosed'),
      display: vi.spyOn(env.userAgent, 'showAlert'),
    };
  });

  it('exposes alert with its zero-argument overload', async () => {
    expect(await prepared().browser.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'alert');
      return {
        type: typeof alert,
        length: typeof alert === 'function' ? alert.length : null,
        writable: descriptor?.writable,
        enumerable: descriptor?.enumerable,
        configurable: descriptor?.configurable,
      };
    })).toEqual({ type: 'function', length: 0, writable: true, enumerable: true, configurable: true });
  });

  it('distinguishes omission from undefined, converts the message once, and ignores extra arguments', async () => {
    const { browser, opened } = prepared();
    expect(await browser.evaluate(() => {
      let conversions = 0, extraConversions = 0;
      const returns: unknown[] = [alert()];
      returns.push(Reflect.apply(alert, window, [undefined]));
      returns.push(Reflect.apply(alert, window, [null]));
      returns.push(Reflect.apply(alert, window, [{ toString() { conversions++; return 'converted'; } }, {
        toString() { extraConversions++; throw new Error('Extra argument was converted'); },
      }]));
      return { conversions, extraConversions, allUndefined: returns.every((value) => value === undefined) };
    })).toEqual({ conversions: 1, extraConversions: 0, allUndefined: true });
    expect(opened.mock.calls.map((call) => call[2])).toEqual(['', 'undefined', 'null', 'converted']);
  });

  it('normalizes newlines and chooses the permitted untruncated message', async () => {
    const { browser, window, opened, closed } = prepared();
    const text = `a\rb\r\nc\nd${'x'.repeat(1000)}`;
    await browser.evaluate((value) => { alert(value); }, text);
    expect(opened).toHaveBeenCalledExactlyOnceWith(window, 'alert', `a\nb\nc\nd${'x'.repeat(1000)}`);
    expect(closed).toHaveBeenCalledExactlyOnceWith(window, 'alert', true);
  });

  it.each(['accept', 'dismiss'] as const)('lets automation %s an alert while reporting acknowledgement', async (handler) => {
    const { browser, window, env, opened, closed, display } = prepared();
    opened.mockReturnValue(handler);
    const pause = vi.spyOn(env.responsibleEventLoop, 'pauseUntil');
    expect(await browser.evaluate(() => alert('automation'))).toBeUndefined();
    expect(closed).toHaveBeenCalledExactlyOnceWith(window, 'alert', true);
    expect(display).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it('suppresses sandboxed dialogs after Web IDL conversion', () => {
    const { browser, document, opened, closed, display } = prepared();
    document.activeSandboxingFlagSet.add('sandboxed-modals');
    let conversions = 0;
    const message = { toString() { conversions++; return 'blocked'; } };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply supplies the receiver for invalid author argument types
    expect(Reflect.apply(browser.window.alert, browser.window, [message])).toBeUndefined();
    expect(conversions).toBe(1);
    expect(opened).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
  });

  it('reads the live sandbox state after message conversion', () => {
    const { browser, document, opened } = prepared();
    const message = { toString() { document.activeSandboxingFlagSet.add('sandboxed-modals'); return 'blocked'; } };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply supplies the receiver while testing author conversion
    Reflect.apply(browser.window.alert, browser.window, [message]);
    expect(opened).not.toHaveBeenCalled();
  });

  it('uses the optional suppression during script termination', async () => {
    const { browser, env, opened, display } = prepared();
    env.responsibleEventLoop.terminationNestingLevel = 1;
    try { await browser.evaluate(() => { alert('terminating'); }); }
    finally { env.responsibleEventLoop.terminationNestingLevel = 0; }
    expect(opened).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
  });

  it('suppresses alerts retained from an inactive Document', () => {
    const { browser, document, env, opened } = prepared();
    const retained = browser.window;
    const navigable = document.getNodeNavigable()!;
    navigable.activeSessionHistoryEntry = env.createSessionHistoryEntry(
      navigable.activeSessionHistoryEntry.url, new DocumentState(),
    );
    expect(document.isFullyActive()).toBe(false);
    expect(retained.alert('inactive')).toBeUndefined();
    expect(opened).not.toHaveBeenCalled();
  });

  it('rejects invalid receivers and Symbol messages before prompt handling', async () => {
    const { browser, opened } = prepared();
    expect(await browser.evaluate(() => {
      const errors = [];
      try { Reflect.apply(alert, {}, ['message']); } catch (error) { errors.push(error instanceof TypeError); }
      try { Reflect.apply(alert, window, [Symbol('message')]); } catch (error) { errors.push(error instanceof TypeError); }
      return errors;
    })).toEqual([true, true]);
    expect(opened).not.toHaveBeenCalled();
  });
});

describe('HTML simple dialogs: confirm() and prompt()', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const window = document.getRelevantGlobalObject()!;
    const env = document.env;
    return {
      browser, document, window, env,
      opened: vi.spyOn(env.userAgent, 'webDriverBiDiUserPromptOpened').mockReturnValue('accept'),
      closed: vi.spyOn(env.userAgent, 'webDriverBiDiUserPromptClosed'),
      confirmDisplay: vi.spyOn(env.userAgent, 'showConfirm'),
      promptDisplay: vi.spyOn(env.userAgent, 'showPrompt'),
    };
  });

  it('exposes confirm and prompt with optional arguments', async () => {
    expect(await prepared().browser.evaluate(() => ['confirm', 'prompt'].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      const method: unknown = descriptor?.value;
      return {
        type: typeof method,
        length: typeof method === 'function' ? method.length : null,
        writable: descriptor?.writable,
        enumerable: descriptor?.enumerable,
        configurable: descriptor?.configurable,
      };
    }))).toEqual([
      { type: 'function', length: 0, writable: true, enumerable: true, configurable: true },
      { type: 'function', length: 0, writable: true, enumerable: true, configurable: true },
    ]);
  });

  it('defaults omitted and undefined arguments, converts null, and ignores extra arguments', async () => {
    const { browser, opened } = prepared();
    expect(await browser.evaluate(() => {
      const order: string[] = [];
      const message = { toString() { order.push('message'); return 'converted message'; } };
      const defaultValue = { toString() { order.push('default'); return 'converted default'; } };
      const extra = { toString() { throw new Error('Extra argument was converted'); } };
      const values: unknown[] = [confirm(), confirm(undefined)];
      values.push(Reflect.apply(confirm, window, [null]));
      values.push(Reflect.apply(confirm, window, [message, extra]));
      values.push(prompt(), prompt(undefined, undefined), prompt('question'));
      values.push(Reflect.apply(prompt, window, [null, null]));
      values.push(Reflect.apply(prompt, window, [message, defaultValue, extra]));
      return { order, values };
    })).toEqual({ order: ['message', 'message', 'default'], values: [true, true, true, true, '', '', '', '', ''] });
    expect(opened.mock.calls.map((call) => call.slice(1))).toEqual([
      ['confirm', ''], ['confirm', ''], ['confirm', 'null'], ['confirm', 'converted message'],
      ['prompt', '', ''], ['prompt', '', ''], ['prompt', 'question', ''], ['prompt', 'null', 'null'],
      ['prompt', 'converted message', 'converted default'],
    ]);
  });

  it('normalizes messages and preserves complete default text for the BiDi notification', async () => {
    const { browser, window, opened } = prepared();
    const text = `a\rb\r\nc\nd${'x'.repeat(1000)}`;
    await browser.evaluate((value) => { confirm(value); prompt(value, value); }, text);
    const normalized = `a\nb\nc\nd${'x'.repeat(1000)}`;
    expect(opened).toHaveBeenNthCalledWith(1, window, 'confirm', normalized);
    expect(opened).toHaveBeenNthCalledWith(2, window, 'prompt', normalized, text);
  });

  it.each([
    ['accept', true, ''], ['dismiss', false, null],
  ] as const)('uses automation %s without display or pause', async (handler, confirmation, text) => {
    const { browser, window, env, opened, closed, confirmDisplay, promptDisplay } = prepared();
    opened.mockReturnValue(handler);
    const pause = vi.spyOn(env.responsibleEventLoop, 'pauseUntil');
    expect(await browser.evaluate(() => [confirm('question'), prompt('question', 'default')])).toEqual([confirmation, text]);
    expect(closed).toHaveBeenNthCalledWith(1, window, 'confirm', confirmation);
    expect(closed).toHaveBeenNthCalledWith(2, window, 'prompt', text !== null, text);
    expect(confirmDisplay).not.toHaveBeenCalled();
    expect(promptDisplay).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it.each(['sandbox', 'termination', 'inactive'] as const)('returns false and null under %s suppression', (reason) => {
    const { browser, document, env, opened, closed, confirmDisplay, promptDisplay } = prepared();
    const retained = browser.window;
    if (reason === 'sandbox') {
      document.activeSandboxingFlagSet.add('sandboxed-modals');
    } else if (reason === 'termination') {
      env.responsibleEventLoop.terminationNestingLevel = 1;
    } else {
      const navigable = document.getNodeNavigable()!;
      navigable.activeSessionHistoryEntry = env.createSessionHistoryEntry(
        navigable.activeSessionHistoryEntry.url, new DocumentState(),
      );
    }
    try {
      expect(retained.confirm('blocked')).toBe(false);
      expect(retained.prompt('blocked', 'default')).toBeNull();
    } finally { env.responsibleEventLoop.terminationNestingLevel = 0; }
    expect(opened).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(confirmDisplay).not.toHaveBeenCalled();
    expect(promptDisplay).not.toHaveBeenCalled();
  });

  it('converts both prompt arguments before consulting live admission state', () => {
    const { browser, document, opened } = prepared();
    const order: string[] = [];
    const message = { toString() { order.push('message'); return 'question'; } };
    const defaultValue = {
      toString() { order.push('default'); document.activeSandboxingFlagSet.add('sandboxed-modals'); return 'default'; },
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply supplies the receiver for author conversion
    expect(Reflect.apply(browser.window.prompt, browser.window, [message, defaultValue])).toBeNull();
    expect(order).toEqual(['message', 'default']);
    expect(opened).not.toHaveBeenCalled();
  });

  it('rejects invalid receivers and Symbol arguments before prompt handling', async () => {
    const { browser, opened } = prepared();
    expect(await browser.evaluate(() => {
      const errors: boolean[] = [];
      for (const operation of [
        () => { Reflect.apply(confirm, {}, ['message']); },
        () => { Reflect.apply(prompt, {}, ['message']); },
        () => { Reflect.apply(confirm, window, [Symbol('message')]); },
        () => { Reflect.apply(prompt, window, [Symbol('message'), 'default']); },
        () => { Reflect.apply(prompt, window, ['message', Symbol('default')]); },
      ]) {
        try { operation(); } catch (error) { errors.push(error instanceof TypeError); }
      }
      return errors;
    })).toEqual([true, true, true, true, true]);
    expect(opened).not.toHaveBeenCalled();
  });
});

describe('simple dialog host pause', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const userAgent = createManualUserAgent();
    const traversable = TopLevelTraversable.create(userAgent, null, '');
    const window = traversable.activeWindow!;
    const env = window.env;
    return {
      window, env, loop: env.responsibleEventLoop,
      opened: vi.spyOn(userAgent, 'webDriverBiDiUserPromptOpened'),
      closed: vi.spyOn(userAgent, 'webDriverBiDiUserPromptClosed'),
      display: vi.spyOn(userAgent, 'showAlert'),
      confirmDisplay: vi.spyOn(userAgent, 'showConfirm'),
      promptDisplay: vi.spyOn(userAgent, 'showPrompt'),
    };
  });

  it('stalls tasks and microtasks until acknowledgement, then closes the prompt', () => runInHostTask(() => {
    const { window, env, loop, opened, closed, display } = prepared();
    const order: string[] = [];
    display.mockImplementation((received, message) => {
      expect(received).toBe(window);
      expect(message).toBe('line\nbreak');
      order.push('display');
      loop.queueTask(domManipulationTaskSource, null, { run: () => { order.push('task'); } });
      loop.queueMicrotask(() => { order.push('microtask'); });
      expect(loop.runTaskTurn()).toBe(false);
      loop.performMicrotaskCheckpoint();
      expect(order).toEqual(['display']);
    });
    closed.mockImplementation(() => { order.push('closed'); });
    loop.runScriptEvaluation(env, () => {
      expect(env.realm.windowProxy.platform.alert('line\r\nbreak')).toBeUndefined();
      order.push('returned');
      expect(order).toEqual(['display', 'closed', 'returned']);
    });
    while (loop.runTaskTurn()) { /* Deliver the task queued by the simulated host. */ }
    expect(order).toEqual(['display', 'closed', 'returned', 'microtask', 'task']);
    expect(opened).toHaveBeenCalledExactlyOnceWith(window, 'alert', 'line\nbreak');
    expect(closed).toHaveBeenCalledExactlyOnceWith(window, 'alert', true);
  }));

  it('restores the pause when the host fails without reporting a completed prompt', () => runInHostTask(() => {
    const { window, env, loop, closed, display } = prepared();
    const failure = new Error('host failed');
    display.mockImplementation(() => { throw failure; });
    loop.runScriptEvaluation(env, () => {
      expect(() => window.alert('message')).toThrow(failure);
    });
    expect(closed).not.toHaveBeenCalled();
    let ran = false;
    loop.queueTask(domManipulationTaskSource, null, { run: () => { ran = true; } });
    expect(loop.runTaskTurn()).toBe(true);
    expect(ran).toBe(true);
  }));

  it('retains the explicit missing display dependency', () => runInHostTask(() => {
    const { window, env, loop, closed } = prepared();
    loop.runScriptEvaluation(env, () => {
      expect(() => window.alert('message')).toThrow('Alert display and acknowledgement UI are not implemented');
    });
    expect(closed).not.toHaveBeenCalled();
  }));

  it.each([true, false])('pauses for confirmation and returns %s before resuming work', (response) => runInHostTask(() => {
    const { window, env, loop, opened, closed, confirmDisplay } = prepared();
    const order: string[] = [];
    opened.mockImplementation(() => { order.push('opened'); return 'none'; });
    confirmDisplay.mockImplementation((received, message) => {
      expect(received).toBe(window);
      expect(message).toBe('line\nbreak');
      order.push('display');
      loop.queueTask(domManipulationTaskSource, null, { run: () => { order.push('task'); } });
      loop.queueMicrotask(() => { order.push('microtask'); });
      expect(loop.runTaskTurn()).toBe(false);
      loop.performMicrotaskCheckpoint();
      expect(order).toEqual(['opened', 'display']);
      return response;
    });
    closed.mockImplementation(() => { order.push('closed'); });
    loop.runScriptEvaluation(env, () => {
      expect(env.realm.windowProxy.platform.confirm('line\r\nbreak')).toBe(response);
      order.push('returned');
      expect(order).toEqual(['opened', 'display', 'closed', 'returned']);
    });
    while (loop.runTaskTurn()) { /* Deliver the task queued by the simulated host. */ }
    expect(order).toEqual(['opened', 'display', 'closed', 'returned', 'microtask', 'task']);
    expect(opened).toHaveBeenCalledExactlyOnceWith(window, 'confirm', 'line\nbreak');
    expect(closed).toHaveBeenCalledExactlyOnceWith(window, 'confirm', response);
  }));

  it.each([null, '', ' unchanged\r\ntext\u0000 '])('returns the prompt host response %j without replacing empty text', (response) => runInHostTask(() => {
    const { window, env, loop, opened, closed, promptDisplay } = prepared();
    const order: string[] = [];
    opened.mockImplementation(() => { order.push('opened'); return 'none'; });
    promptDisplay.mockImplementation((received, message, defaultValue) => {
      expect(received).toBe(window);
      expect(message).toBe('line\nbreak');
      expect(defaultValue).toBe('default\r\ntext');
      order.push('display');
      loop.queueMicrotask(() => { order.push('microtask'); });
      loop.performMicrotaskCheckpoint();
      expect(order).toEqual(['opened', 'display']);
      return response;
    });
    closed.mockImplementation(() => { order.push('closed'); });
    loop.runScriptEvaluation(env, () => {
      expect(env.realm.windowProxy.platform.prompt('line\r\nbreak', 'default\r\ntext')).toBe(response);
      order.push('returned');
      expect(order).toEqual(['opened', 'display', 'closed', 'returned']);
    });
    expect(order).toEqual(['opened', 'display', 'closed', 'returned', 'microtask']);
    expect(opened).toHaveBeenCalledExactlyOnceWith(window, 'prompt', 'line\nbreak', 'default\r\ntext');
    expect(closed).toHaveBeenCalledExactlyOnceWith(window, 'prompt', response !== null, response);
  }));

  it.each(['confirm', 'prompt'] as const)('restores the pause after %s host failure without closing the prompt', (method) => runInHostTask(() => {
    const { window, env, loop, closed, confirmDisplay, promptDisplay } = prepared();
    const failure = new Error('host failed');
    confirmDisplay.mockImplementation(() => { throw failure; });
    promptDisplay.mockImplementation(() => { throw failure; });
    loop.runScriptEvaluation(env, () => {
      expect(() => method === 'confirm' ? window.confirm('message') : window.prompt('message', '')).toThrow(failure);
    });
    expect(closed).not.toHaveBeenCalled();
    let ran = false;
    loop.queueTask(domManipulationTaskSource, null, { run: () => { ran = true; } });
    expect(loop.runTaskTurn()).toBe(true);
    expect(ran).toBe(true);
  }));

  it('retains separate missing confirmation and text UI dependencies', () => runInHostTask(() => {
    const { window, env, loop, closed } = prepared();
    loop.runScriptEvaluation(env, () => {
      expect(() => window.confirm('message')).toThrow('Confirmation display and response UI are not implemented');
      expect(() => window.prompt('message', 'default')).toThrow('Text prompt display and response UI are not implemented');
    });
    expect(closed).not.toHaveBeenCalled();
  }));
});
