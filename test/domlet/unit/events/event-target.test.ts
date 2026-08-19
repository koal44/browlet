import { describe, expect, it, vi } from 'vitest';
import { Domlet } from '../../../../src/domlet/domlet';
import { EventTargetImpl } from '../../../../src/domlet/events/event-target';
import { EventImpl } from '../../../../src/domlet/events/event';

describe('EventTargetImpl', () => {
  it('is the event target base for DOM nodes', () => {
    const domlet = new Domlet();
    const document = domlet.parse('<main id="target"></main>');
    const { EventTarget } = domlet.bindings;

    expect(document).toBeInstanceOf(EventTarget);
    expect(document.documentElement).toBeInstanceOf(EventTarget);
    expect(document.getElementById('target')).toBeInstanceOf(EventTarget);
  });

  it('performs the immediately observable Web IDL conversions', () => {
    const target = new EventTargetImpl();

    expect(() => target.addEventListener(
      Symbol('type') as unknown as string,
      null,
    )).toThrow(TypeError);
    expect(() => target.removeEventListener(
      Symbol('type') as unknown as string,
      null,
    )).toThrow(TypeError);
  });

  it('flattens every addEventListener option in specification order', () => {
    const target = new EventTargetImpl();
    const accesses: string[] = [];
    const signal = new AbortController().signal;
    const options = {
      get capture() { accesses.push('capture'); return 1; },
      get once() { accesses.push('once'); return 1; },
      get passive() { accesses.push('passive'); return 0; },
      get signal() { accesses.push('signal'); return signal; },
    } as unknown as AddEventListenerOptions;

    target.addEventListener('ready', () => {}, options);

    expect(accesses).toEqual(['capture', 'once', 'passive', 'signal']);
  });

  it('only flattens capture when removing an event listener', () => {
    const target = new EventTargetImpl();
    const accesses: string[] = [];
    const options = {
      get capture() { accesses.push('capture'); return true; },
      get once() { throw new Error('once must not be read'); },
      get passive() { throw new Error('passive must not be read'); },
      get signal() { throw new Error('signal must not be read'); },
    } as unknown as AddEventListenerOptions;

    target.removeEventListener('ready', () => {}, options);

    expect(accesses).toEqual(['capture']);
  });

  it('does not install abort steps for null callbacks or aborted signals', () => {
    const target = new EventTargetImpl();
    const liveController = new AbortController();
    const abortedController = new AbortController();
    const liveAdd = vi.spyOn(liveController.signal, 'addEventListener');
    const abortedAdd = vi.spyOn(abortedController.signal, 'addEventListener');
    abortedController.abort();

    target.addEventListener('null', null, { signal: liveController.signal });
    target.addEventListener('aborted', () => {}, {
      signal: abortedController.signal,
    });

    expect(liveAdd).not.toHaveBeenCalled();
    expect(abortedAdd).not.toHaveBeenCalled();
  });

  it('installs abort steps for a registered listener', () => {
    const target = new EventTargetImpl();
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');

    target.addEventListener('ready', () => {}, { signal: controller.signal });

    expect(addEventListener).toHaveBeenCalledOnce();
    expect(addEventListener).toHaveBeenCalledWith(
      'abort',
      expect.any(Function),
      { once: true },
    );
  });

  it('fails loudly until the DOM dispatch algorithm is implemented', () => {
    const target = new EventTargetImpl();

    expect(() => target.dispatchEvent(new EventImpl('ready')))
      .toThrow('DOM section 2.9 event dispatch is not implemented');
  });

  it.todo('suppresses duplicate event listeners during dispatch');
  it.todo('removes event listeners by type, callback, and capture');
  it.todo('removes once listeners after invocation');
  it.todo('removes signal-bound listeners when their signal aborts');
});
