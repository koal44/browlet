import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { navigationAndTraversalTaskSource } from '../../../../src/browlet/scripting/tasks';
import { unwrap } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('HTML steps to fire beforeunload', () => {
  it('dispatches a trusted event on Window with the Document target and blocks window opening during callbacks', async () => {
    const { browser, document, loop, admission } = await fixture('none');
    document.unloadCounter = 2;
    loop.terminationNestingLevel = 4;
    await browser.evaluate(() => {
      addEventListener('beforeunload', (event) => {
        globalThis.document.body.textContent = JSON.stringify({
          type: event.type, branded: event instanceof BeforeUnloadEvent,
          target: event.target === globalThis.document, currentTarget: event.currentTarget === window,
          phase: event.eventPhase, flags: [event.isTrusted, event.bubbles, event.cancelable, event.composed],
          value: event.returnValue as unknown, current: window.event === event, open: window.open() === null,
        });
      });
    });
    const counters: number[][] = [];
    browser.window.addEventListener('beforeunload', () => {
      counters.push([document.unloadCounter, loop.terminationNestingLevel]);
    });

    expect(document.fireBeforeUnload(false)).toEqual([false, false]);

    expect(JSON.parse(browser.document.body!.textContent!)).toEqual({
      type: 'beforeunload', branded: true, target: true, currentTarget: true, phase: 2,
      flags: [true, false, true, false], value: '', current: true, open: true,
    });
    expect(counters).toEqual([[3, 5]]);
    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([2, 4]);
    expect(admission).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'value', 'empty-handler'] as const)('requests confirmation for %s using the existing handler machinery', async (mode) => {
    const { document, window, admission, opened, closed, confirmation } = await fixture(mode);

    expect(document.fireBeforeUnload(false)).toEqual([true, false]);

    expect(admission).toHaveBeenCalledExactlyOnceWith(document);
    expect(opened).toHaveBeenCalledExactlyOnceWith(window, 'beforeunload', '');
    expect(closed).toHaveBeenCalledExactlyOnceWith(window, 'beforeunload', true);
    expect(confirmation).not.toHaveBeenCalled();
  });

  it.each(['already-shown', 'sandboxed', 'never-activated', 'policy'] as const)(
    'still fires the event but suppresses the prompt when %s', async (gate) => {
      const { browser, document, window, admission, opened, closed, confirmation } = await fixture();
      if (gate === 'sandboxed') document.activeSandboxingFlagSet.add('sandboxed-modals');
      if (gate === 'never-activated') window.lastActivationTimestamp = Infinity;
      if (gate === 'policy') admission.mockReturnValue(false);
      const listener = vi.fn();
      browser.window.addEventListener('beforeunload', listener);
      const shown = gate === 'already-shown';

      expect(document.fireBeforeUnload(shown)).toEqual([shown, false]);

      expect(listener).toHaveBeenCalledOnce();
      expect(admission).toHaveBeenCalledTimes(gate === 'policy' ? 1 : 0);
      expect(opened).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      expect(confirmation).not.toHaveBeenCalled();
    },
  );

  it.each(['accept', 'dismiss'] as const)('honors BiDi %s without entering the host wait', async (handler) => {
    const { document, window, loop, opened, closed, confirmation } = await fixture();
    const pause = vi.spyOn(loop, 'pauseUntil');
    opened.mockImplementation(() => {
      expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([1, 0]);
      return handler;
    });

    expect(document.fireBeforeUnload(false)).toEqual([true, handler === 'dismiss']);

    expect(closed).toHaveBeenCalledExactlyOnceWith(window, 'beforeunload', handler === 'accept');
    expect(pause).not.toHaveBeenCalled();
    expect(confirmation).not.toHaveBeenCalled();
    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([0, 0]);
  });

  it.each([true, false])('pauses the owning task for host confirmation=%s and resumes before closing the prompt', async (accepted) => {
    const { document, window, env, loop, opened, closed, confirmation } = await fixture('value');
    opened.mockRestore(); // No BiDi session: the production hook leaves the decision to the host.
    const order: string[] = [];
    let result: [boolean, boolean] | undefined;
    confirmation.mockImplementation((received) => {
      expect(received).toBe(document);
      expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([1, 0]);
      order.push('confirm');
      loop.queueTask(navigationAndTraversalTaskSource, null, { run: () => { order.push('task'); } });
      loop.queueMicrotask(() => { order.push('microtask'); });
      expect(loop.runTaskTurn()).toBe(false);
      loop.performMicrotaskCheckpoint();
      expect(order).toEqual(['confirm']);
      return accepted;
    });
    closed.mockImplementation(() => {
      expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([1, 0]);
      expect(loop.currentlyRunningTask).not.toBeNull();
      order.push('closed');
    });

    await runInHostTask(() => {
      loop.runScriptEvaluation(env, () => {
        result = document.fireBeforeUnload(false);
        order.push('returned');
        expect(order).toEqual(['confirm', 'closed', 'returned']);
      });
      while (loop.runTaskTurn()) { /* Drain the task queued by the simulated host. */ }
      expect(order).toEqual(['confirm', 'closed', 'returned', 'microtask', 'task']);
    });

    expect(result).toEqual([true, !accepted]);
    expect(closed).toHaveBeenCalledExactlyOnceWith(window, 'beforeunload', accepted);
    expect(confirmation).toHaveBeenCalledExactlyOnceWith(document);
    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([0, 0]);
  });

  it('uses the live prompt gates after dispatch, including sandbox changes made by a listener', async () => {
    const { browser, document, admission, opened } = await fixture();
    browser.window.addEventListener('beforeunload', () => { document.activeSandboxingFlagSet.add('sandboxed-modals'); });

    expect(document.fireBeforeUnload(false)).toEqual([false, false]);

    expect(admission).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it.each(['dispatch', 'admission', 'confirmation'] as const)('restores the counters when %s fails internally', async (phase) => {
    const { document, window, env, loop, admission, opened, closed, confirmation } = await fixture();
    const failure = new Error('internal failure');
    const fail = () => { throw failure; };
    if (phase === 'dispatch') vi.spyOn(window, 'dispatch').mockImplementation(fail);
    if (phase === 'admission') admission.mockImplementation(fail);
    if (phase === 'confirmation') {
      opened.mockReturnValue('none');
      confirmation.mockImplementation(fail);
    }
    document.unloadCounter = 2;
    loop.terminationNestingLevel = 3;

    await runInHostTask(() => loop.runScriptEvaluation(env, () => {
      expect(() => document.fireBeforeUnload(false)).toThrow(failure);
      expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([2, 3]);
    }));

    expect(closed).not.toHaveBeenCalled();
  });

  it('stops at the explicit policy and host dependencies rather than approving a missing prompt', async () => {
    const { document, env, loop, admission, opened } = await fixture();
    admission.mockRestore();
    expect(() => document.fireBeforeUnload(false)).toThrow('Beforeunload prompt admission policy is not implemented');
    vi.spyOn(env.userAgent, 'shouldShowBeforeUnloadPrompt').mockReturnValue(true);
    opened.mockRestore();

    await runInHostTask(() => loop.runScriptEvaluation(env, () => {
      expect(() => document.fireBeforeUnload(false)).toThrow('Beforeunload confirmation UI is not implemented');
    }));

    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([0, 0]);
  });
});

async function fixture(mode: 'none' | 'cancel' | 'value' | 'empty-handler' = 'cancel') {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/before');
  await browser.evaluate((mode) => {
    if (mode === 'empty-handler') {
      onbeforeunload = () => '';
    } else {
      addEventListener('beforeunload', (event) => {
        if (mode === 'cancel') event.preventDefault();
        if (mode === 'value') event.returnValue = 'Author text must not become the prompt message';
      });
    }
  }, mode);
  const document = unwrap<DocumentImpl>(browser.document);
  const env = document.env;
  const window = document.getRelevantGlobalObject()!;
  // Input notification is unfinished; consumed activation still satisfies the real sticky predicate.
  window.lastActivationTimestamp = -Infinity;
  return {
    browser, document, window, env, loop: env.responsibleEventLoop,
    admission: vi.spyOn(env.userAgent, 'shouldShowBeforeUnloadPrompt').mockReturnValue(true),
    opened: vi.spyOn(env.userAgent, 'webDriverBiDiUserPromptOpened').mockReturnValue('accept'),
    closed: vi.spyOn(env.userAgent, 'webDriverBiDiUserPromptClosed'),
    confirmation: vi.spyOn(env.userAgent, 'requestUnloadConfirmation'),
  };
}
